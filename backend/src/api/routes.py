from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from core.schemas import parse_indexing_request


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
            default_model=settings.vlm_model,
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
