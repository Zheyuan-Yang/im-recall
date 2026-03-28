# Frontend Notes

This folder is reserved for the Vite + React desktop UI.

For now, the important runtime path is:

```text
/hdd_linux/test
```

The backend indexing service uses this folder as the default image library and stores
the SQLite DB file next to the images:

```text
/hdd_linux/test/photo_index.db
```

This is a good current default. For packaged desktop builds later, move the folder to
the app's user-data directory and pass the resolved path into the backend via env vars.

## Suggested Responsibility Split

- Frontend app layer: query rewrite/planning, SQLite query, local filters, DINO rerank, copy/export, and search session state.
- Backend Flask service: HTTP routes and app wiring only.
- Indexing/model layer: indexing jobs, single-model embedding extraction, EXIF/geocode enrichment, DB migrations/writes, and OpenAI-compatible vision/caption calls.
- Shared support code now lives in `core/`, so frontend query code does not import `backend/src`.
- React UI should talk to a frontend-side query adapter instead of importing raw SQLite code directly.
- The active VLM profile lives in the repo-root `config.yaml`, not in the frontend.

The current Python query prototype already lives on the frontend side in
`frontend/querying/`, so query orchestration is no longer under `backend/src`.

## Query Modules

The final app should move query logic into `frontend/src/query/` with a shape like:

```text
frontend/src/query/
  planner.ts        # natural-language -> query json
  sqlite.ts         # local DB reads
  retrieval.ts      # candidate fetch + score merge
  rerank.ts         # DINO diversity / near-duplicate suppression
  export.ts         # copy top-k images to the current target folder
```

The current Python files under `frontend/querying/` are still a prototype and
smoke-test harness, but they already match the intended product boundary better
than putting query code under `backend/src`.
