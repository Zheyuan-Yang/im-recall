# Frontend Notes

This folder now contains the first desktop-oriented `Vite + React + TypeScript`
frontend for MemoLens.

## Run

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on `http://127.0.0.1:5173` by default.

## Backend Connection

- The UI now probes `GET /healthz` and, when the backend is reachable, sends real
  queries to `POST /v1/retrieval/query`.
- Returned images are displayed via `GET /v1/library/files/<relative_path>`.
- If the backend is offline, or retrieval fails, the page falls back to the local
  mock curation flow so the app still remains usable.
- In dev mode, Vite proxies `/healthz` and `/v1/*` to `http://127.0.0.1:5000`.
- If you want to target another backend, set `VITE_BACKEND_BASE_URL`.

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

The app-side query code now starts in `frontend/src/query/`, with the current mock
studio generator living next to the intended production boundary:

```text
frontend/src/query/
  api.ts            # backend retrieval adapter + response mapping
  mockLibrary.ts    # local photo cards and preset prompts for the UI demo
  studio.ts         # prompt analysis + mock draft generation
  types.ts          # typed result/state contracts for the UI
```

The current Python files under `frontend/querying/` are still a prototype and
smoke-test harness, but they already match the intended product boundary better
than putting query code under `backend/src`.
