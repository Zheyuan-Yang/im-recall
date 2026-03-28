# Query Layer

This folder should own app-side retrieval logic.

## Put These In Frontend

- Natural-language query rewrite into structured JSON
- Current datetime injection for relative dates like `last December`
- SQLite candidate fetch
- Text similarity scoring against `combined_text_embedding`
- DINO rerank and near-duplicate suppression
- Copying the final top-k results to the local output folder

## Keep These In Backend

- Flask routes
- Indexing jobs
- EXIF parsing and reverse geocoding
- VLM image description / tagging
- DINO image embedding generation
- Text embedding generation during indexing
- SQLite schema creation and migration

## Shared Core

- `core/config.py` for settings and config loading
- `core/db.py` for SQLite repository access
- `core/schemas.py` for shared data shapes
- `core/text_embeddings.py` and `core/semantic_hints.py` for shared text-processing utilities

## Current Python Reference Mapping

- `frontend/querying/planner.py` -> `frontend/src/query/planner.ts`
- `frontend/querying/retrieval.py` -> `frontend/src/query/retrieval.ts`
- `scripts/test_query.py` -> local smoke-test helper only
