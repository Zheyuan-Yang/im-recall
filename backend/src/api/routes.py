from __future__ import annotations

from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, request, send_file

from core.db import ImageIndexRepository
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

    db_path_override = payload.get("db_path")
    image_library_dir_override = payload.get("image_library_dir")

    if db_path_override is not None and (
        not isinstance(db_path_override, str) or not db_path_override.strip()
    ):
        return (
            jsonify(
                {
                    "object": "error",
                    "message": "`db_path` must be a non-empty string when set.",
                    "type": "invalid_request_error",
                }
            ),
            400,
        )

    if image_library_dir_override is not None and (
        not isinstance(image_library_dir_override, str) or not image_library_dir_override.strip()
    ):
        return (
            jsonify(
                {
                    "object": "error",
                    "message": "`image_library_dir` must be a non-empty string when set.",
                    "type": "invalid_request_error",
                }
            ),
            400,
        )

    image_library_dir = (
        Path(image_library_dir_override).expanduser().resolve()
        if isinstance(image_library_dir_override, str) and image_library_dir_override.strip()
        else settings.image_library_dir.resolve()
    )

    if not image_library_dir.exists() or not image_library_dir.is_dir():
        return (
            jsonify(
                {
                    "object": "error",
                    "message": f"Image library directory does not exist: {image_library_dir}",
                    "type": "invalid_request_error",
                }
            ),
            400,
        )

    if isinstance(db_path_override, str) and db_path_override.strip():
        repository = ImageIndexRepository(Path(db_path_override).expanduser().resolve())
        repository.ensure_schema()
        retrieval_service = current_app.extensions["retrieval_service"].__class__(
            settings=settings,
            repository=repository,
            planner=current_app.extensions["query_planner"],
            text_embedding_service=current_app.extensions["text_embedding_service"],
        )
    else:
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
                image_library_dir=image_library_dir,
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
    root_path_override = request.args.get("root_path")
    library_root = (
        Path(root_path_override).expanduser().resolve()
        if isinstance(root_path_override, str) and root_path_override.strip()
        else settings.image_library_dir.resolve()
    )
    file_path = (library_root / relative_path).resolve()

    try:
        file_path.relative_to(library_root)
    except ValueError:
        abort(404)

    if not file_path.exists() or not file_path.is_file():
        abort(404)

    return send_file(Path(file_path), conditional=True)
