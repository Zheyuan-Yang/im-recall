# MemoLens

Search, curate, and export post-ready photo sets from a local library with an Electron app, a Flask retrieval backend, SQLite indexing, and a Discord bot.

## GitHub About

Recommended repo description:

`Search, curate, and export post-ready photo sets from a local library with Electron, Flask, SQLite, and Discord.`

## What It Is

MemoLens is a local-first photo retrieval tool for turning a large personal image library into a tighter, post-ready selection.

The project currently includes:

- an Electron desktop app for indexing, prompt-based retrieval, curation, and export
- a Flask backend that serves retrieval, indexing, and file access APIs
- a local SQLite photo index backed by image analysis metadata
- a Discord bot that can send retrieval results back into chat

## What It Can Do

- index a local image folder into a `photo_index.db`
- pause and resume local indexing in the desktop app
- retrieve images from natural-language prompts
- generate a curated 9-image draft with title and caption
- export the resulting draft as a text file
- send retrieval results through Discord with resized image attachments

## Repo Layout

- `src/`: React renderer for the Electron app
- `electron/`: Electron main process, folder picking, local indexing, and IPC
- `backend/`: Flask app entrypoint and API wiring
- `frontend/querying/`: retrieval planning, ranking, and copy generation logic
- `core/`: shared config and runtime helpers
- `photon-bot/`: Discord bot adapter for the retrieval backend
- `indexing/`: image indexing and metadata generation pipeline

## Quick Start

### 1. Install root dependencies

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Start the backend

```bash
python3 backend/app.py
```

The backend runs on `http://127.0.0.1:5000` by default.

### 3. Start the desktop app

```bash
npm run electron
```

For hot-reload UI development:

```bash
npm run dev
ELECTRON_RENDERER_URL=http://127.0.0.1:5173 npx electron --no-sandbox .
```

### 4. Optional: start the Discord bot

```bash
cd photon-bot
npm install
npm run doctor:discord
npm run dev
```

The bot expects a valid `DISCORD_BOT_TOKEN` and a running backend.

## Configuration

Runtime defaults are defined in [`config.yaml`](./config.yaml).

The most important paths are:

- `app.image_library_dir`
- `app.sqlite_db_path`

For local bot or backend runs, you can also override paths with environment variables such as:

- `IMAGE_LIBRARY_DIR`
- `SQLITE_DB_PATH`
- `VITE_BACKEND_BASE_URL`
- `DISCORD_BOT_TOKEN`
- `DISCORD_ALLOWED_CHANNEL_IDS`

## Desktop Workflow

1. Pick a local image folder in the Electron app.
2. Run indexing to build or update `photo_index.db`.
3. Enter a prompt describing the mood, place, time, or subject.
4. Generate a curated result set.
5. Copy the caption or export the draft.

## Notes

- The desktop app can fall back to a local mock draft flow when the backend is unavailable.
- The backend and bot need access to the same indexed dataset if you want retrieval results and image attachments to line up exactly.
- Discord images are resized before sending to reduce upload failures.

## Commands

Root app:

```bash
npm run typecheck
npm run build
npm run electron
```

Discord bot:

```bash
cd photon-bot
npm run typecheck
npm run build
npm run dev
```
