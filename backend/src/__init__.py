from __future__ import annotations

from flask import Flask

from core.config import Settings
from core.db import ImageIndexRepository
from core.text_embeddings import TextEmbeddingService
from frontend.querying import (
    OpenAICompatibleQueryPlanner,
    RetrievalCopywriter,
    RetrievalService,
)
from indexing.embeddings import EmbeddingService
from indexing.geocoder import ReverseGeocoder
from indexing.pipeline import IndexingService
from indexing.vision import OpenAICompatibleVisionClient

from .api import api_blueprint


def create_app(settings: Settings | None = None) -> Flask:
    resolved_settings = settings or Settings.from_env()
    resolved_settings.ensure_directories()

    app = Flask(__name__)
    app.config["SETTINGS"] = resolved_settings

    repository = ImageIndexRepository(resolved_settings.db_path)
    repository.ensure_schema()

    app.extensions["image_index_repository"] = repository
    app.extensions["vision_client"] = OpenAICompatibleVisionClient(resolved_settings)
    app.extensions["embedding_service"] = EmbeddingService(resolved_settings)
    app.extensions["text_embedding_service"] = TextEmbeddingService(resolved_settings)
    app.extensions["geocoder"] = ReverseGeocoder(resolved_settings)
    app.extensions["query_planner"] = OpenAICompatibleQueryPlanner(resolved_settings)
    app.extensions["retrieval_copywriter"] = RetrievalCopywriter(resolved_settings)
    app.extensions["indexing_service"] = IndexingService(
        settings=resolved_settings,
        repository=repository,
        vision_client=app.extensions["vision_client"],
        embedding_service=app.extensions["embedding_service"],
        text_embedding_service=app.extensions["text_embedding_service"],
        geocoder=app.extensions["geocoder"],
    )
    app.extensions["retrieval_service"] = RetrievalService(
        settings=resolved_settings,
        repository=repository,
        planner=app.extensions["query_planner"],
        text_embedding_service=app.extensions["text_embedding_service"],
    )

    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return response

    app.register_blueprint(api_blueprint)
    return app
