from __future__ import annotations

from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, request, send_file

from core.schemas import parse_indexing_request, parse_retrieval_request


api_blueprint = Blueprint("api", __name__)


@api_blueprint.get("/healthz")
def healthz():
    settings = current_app.config["SETTINGS"]
    return jsonify(
        {
            "status": "ok",
            "object": "health.check",
            "image_library_dir": str(settings.image_library_dir),
            "db_path": str(settings.db_path),
        }
    )


@api_blueprint.post("/v1/indexing/jobs")
def create_indexing_job():
    payload = request.get_json(silent=True) or {}
    settings = current_app.config["SETTINGS"]

    try:
        indexing_request = parse_indexing_request(
            payload=payload,
            default_image_dir=str(settings.image_library_dir),
            default_model=settings.vision_model,
        )
    except ValueError as exc:
        return (
            jsonify(
                {
                    "object": "error",
                    "message": str(exc),
                    "type": "invalid_request_error",
                }
            ),
            400,
        )

    indexing_service = current_app.extensions["indexing_service"]

    try:
        result = indexing_service.run(indexing_request)
    except FileNotFoundError as exc:
        return (
            jsonify(
                {
                    "object": "error",
                    "message": str(exc),
                    "type": "invalid_request_error",
                }
            ),
            400,
        )

    return jsonify(result.to_response())


@api_blueprint.post("/v1/retrieval/query")
def create_retrieval_query():
    payload = request.get_json(silent=True) or {}
    settings = current_app.config["SETTINGS"]

    try:
        retrieval_request = parse_retrieval_request(payload)
    except ValueError as exc:
        return (
            jsonify(
                {
                    "object": "error",
                    "message": str(exc),
                    "type": "invalid_request_error",
                }
            ),
            400,
        )

    retrieval_service = current_app.extensions["retrieval_service"]
    copywriter = current_app.extensions["retrieval_copywriter"]
    result = retrieval_service.run(retrieval_request)
    body = result.to_response()
    body["candidate_count"] = len(result.data)

    if result.status == "completed" and result.data:
        try:
            generated_copy = copywriter.generate(
                query_text=result.query_text,
                retrieved_images=result.data,
                image_library_dir=settings.image_library_dir,
                image_limit=min(6, len(result.data)),
            )
            body["generated_copy"] = generated_copy.to_dict()
            body["title"] = generated_copy.title
            body["caption"] = generated_copy.body
            body["notes"] = generated_copy.highlights
        except Exception as exc:
            body["generated_copy"] = None
            body["copywriting_error"] = str(exc)
    else:
        body["generated_copy"] = None

    return jsonify(body)


@api_blueprint.get("/v1/library/files/<path:relative_path>")
def get_library_file(relative_path: str):
    settings = current_app.config["SETTINGS"]
    library_root = settings.image_library_dir.resolve()
    file_path = (library_root / relative_path).resolve()

    try:
        file_path.relative_to(library_root)
    except ValueError:
        abort(404)

    if not file_path.exists() or not file_path.is_file():
        abort(404)

    return send_file(Path(file_path), conditional=True)
