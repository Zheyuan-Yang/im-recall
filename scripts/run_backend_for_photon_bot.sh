#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_LIBRARY_DIR="${IMAGE_LIBRARY_DIR:-/Users/andrewyang/Desktop/test}"
SQLITE_DB_PATH="${SQLITE_DB_PATH:-${IMAGE_LIBRARY_DIR}/photo_index.db}"
VISION_VLM_PROFILE="${VISION_VLM_PROFILE:-openai_gpt41_mini}"
QUERY_VLM_PROFILE="${QUERY_VLM_PROFILE:-openai_gpt41_mini}"

export IMAGE_LIBRARY_DIR
export SQLITE_DB_PATH
export VISION_VLM_PROFILE
export QUERY_VLM_PROFILE

cd "${PROJECT_ROOT}"
python3 backend/app.py
