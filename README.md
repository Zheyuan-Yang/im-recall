# Image Retrieval App

This repo uses a split frontend/backend layout so the local image library,
SQLite DB, a single image embedding backend, and all external API calls can be managed cleanly.

## Recommended Layout

```text
core/                 # Shared config, schema, DB, and text utility layer
indexing/             # Indexing pipeline, model calls, EXIF/geocode, embeddings

frontend/
  querying/           # Local Python query prototype, no Flask dependency
  src/                # React / Vite UI
    query/            # App-side query planning, SQLite retrieval, rerank, export

backend/
  app.py              # Flask entrypoint
  src/
    api/              # HTTP routes

scripts/              # Project-level smoke tests and migration helpers

config.yaml           # Central config, including multiple VLM profiles
```

## Why This Split Works

- Frontend owns search state, natural-language query planning, SQLite reads, result reranking, result export, and UI.
- Backend owns Flask routes, indexing, embedding extraction, EXIF parsing, geocoding, and all OpenAI-compatible API calls.
- Flask-specific code stays in `backend/`, while indexing/model logic lives in `indexing/`.
- Shared config/schema/DB/text helpers live in `core/`, so frontend query code no longer depends on `backend/src`.
- The DB path is colocated with the real image folder, which matches your preference and keeps local state easy to inspect.
- Query stays local on the app side, while captioning and other heavyweight model work stay in backend.
- VLM settings are centralized in `config.yaml`, with one profile per vision-language model.

## Backend Endpoint

The production backend endpoint should be:

```text
POST /v1/indexing/jobs
```

It scans a folder of local images, extracts metadata, calls an OpenAI-compatible
vision endpoint for tags/description, computes one image embedding, and writes
the result into SQLite.

Before sending image content into embeddings or the vision API, the backend resizes
each image to width `512` while preserving aspect ratio.

The recommended indexing payload shape is now one image per request with base64
content in `input.image.b64`; client code can loop over files and POST them one by one.

There is a local Python retrieval prototype in `frontend/querying/` for smoke
testing, and the final app-side query modules should live in `frontend/src/query/`.

## Split Recommendation

- Put SQLite reads, query rewrite/planning, soft filters, retrieval orchestration,
  DINO reranking, and copy/export behavior on the frontend app side.
- If the frontend is a desktop app, do not run raw SQLite access from the browser UI layer.
- Prefer a small local adapter layer in Electron main / preload or Tauri commands, then expose a typed search API to React.
- Keep embedding model loading, batch indexing, DB schema migration, and all remote model calls inside backend.
- Put reusable config, schema, DB, and embedding-text helpers in `core/`, not under frontend or backend naming.

## Current File Ownership

- Backend-owned now:
  - `backend/app.py`
  - `backend/src/api/`
- Indexing-owned now:
  - `indexing/`
- Shared-owned now:
  - `core/config.py`
  - `core/db.py`
  - `core/schemas.py`
  - `core/text_embeddings.py`
  - `core/semantic_hints.py`
  - `core/llm_utils.py`
- Frontend-owned now:
  - `frontend/querying/`
- Frontend-owned in the final app:
  - `frontend/src/query/planner`
  - `frontend/src/query/sqlite`
  - `frontend/src/query/retrieval`
  - `frontend/src/query/rerank`
  - `frontend/src/query/export`
- Transitional Python reference code that should eventually be mirrored into frontend app code:
  - `frontend/querying/planner.py`
  - `frontend/querying/retrieval.py`
  - `scripts/test_query.py`

## Notes

- The default image folder is `/hdd_linux/test`.
- The default DB path is `/hdd_linux/test/photo_index.db`.
- The default active VLM profile is `openai_gpt41_mini`.
- The default OpenAI endpoint is `https://api.openai.com/v1`.
- `config.yaml` stores per-VLM profile settings, while env vars remain useful for secrets and quick overrides.
- The default embedding backend is `dino` via `EMBEDDING_BACKEND=dino`.
- A simple smoke test script lives at `scripts/test_indexing.py`.
- A natural-language query smoke test script lives at `scripts/test_query.py`, and it does not use Flask or `backend/src`.
- For production desktop packaging, you will probably want to point these paths to
  a user-data directory instead of the repo folder.
