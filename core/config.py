from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .semantic_hints import normalize_semantic_hints


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_path(base_dir: Path, raw_value: str) -> Path:
    path = Path(raw_value).expanduser()
    if not path.is_absolute():
        path = (base_dir / path).resolve()
    else:
        path = path.resolve()
    return path


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Config file does not exist: {path}")

    with path.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle) or {}

    if not isinstance(loaded, dict):
        raise ValueError(f"Config file must contain a top-level mapping: {path}")
    return loaded


@dataclass(slots=True)
class VLMProfile:
    name: str
    provider: str
    base_url: str
    api_key: str | None
    model: str
    temperature: float
    max_tokens: int | None
    response_format: dict[str, Any]


@dataclass(slots=True)
class Settings:
    project_root: Path
    backend_root: Path
    frontend_root: Path
    config_path: Path
    image_library_dir: Path
    db_path: Path
    vision_base_url: str
    vision_api_key: str | None
    vision_model: str
    vision_provider: str
    vision_profile_name: str
    vision_temperature: float
    vision_max_tokens: int | None
    vision_response_format: dict[str, Any]
    query_base_url: str
    query_api_key: str | None
    query_model: str
    query_provider: str
    query_profile_name: str
    query_temperature: float
    query_max_tokens: int | None
    query_response_format: dict[str, Any]
    semantic_hints: dict[str, list[str]]
    embedding_backend: str
    clip_model_id: str
    dino_model_id: str
    text_embedding_model_id: str
    text_embedding_query_prefix: str
    text_embedding_document_prefix: str
    text_embedding_max_length: int
    geocode_enabled: bool
    geocode_user_agent: str
    embedding_device: str | None
    text_embedding_device: str | None
    process_image_width: int

    @classmethod
    def from_env(cls) -> "Settings":
        project_root = Path(__file__).resolve().parents[1]
        backend_root = project_root / "backend"
        frontend_root = project_root / "frontend"
        config_path = _as_path(
            project_root,
            os.getenv("APP_CONFIG_PATH", str(project_root / "config.yaml")),
        )
        config = _load_yaml(config_path)

        app_config = config.get("app") if isinstance(config.get("app"), dict) else {}
        embedding_config = (
            config.get("embedding") if isinstance(config.get("embedding"), dict) else {}
        )
        geocode_config = config.get("geocode") if isinstance(config.get("geocode"), dict) else {}
        retrieval_config = (
            config.get("retrieval") if isinstance(config.get("retrieval"), dict) else {}
        )
        vlm_config = config.get("vlm") if isinstance(config.get("vlm"), dict) else {}
        raw_profiles = (
            vlm_config.get("profiles") if isinstance(vlm_config.get("profiles"), dict) else {}
        )

        image_library_dir = Path(
            os.getenv(
                "IMAGE_LIBRARY_DIR",
                str(app_config.get("image_library_dir", "/hdd_linux/test")),
            )
        ).expanduser().resolve()
        db_path = Path(
            os.getenv(
                "SQLITE_DB_PATH",
                str(app_config.get("sqlite_db_path", image_library_dir / "photo_index.db")),
            )
        ).expanduser().resolve()

        legacy_profile_name = os.getenv("VLM_PROFILE")
        vision_profile_name = os.getenv(
            "VISION_VLM_PROFILE",
            (
                legacy_profile_name
                or str(vlm_config.get("vision_active") or vlm_config.get("active", "")).strip()
            ),
        )
        query_profile_name = os.getenv(
            "QUERY_VLM_PROFILE",
            (
                legacy_profile_name
                or str(vlm_config.get("query_active") or vlm_config.get("active", "")).strip()
            ),
        )

        vision_profile = _resolve_vlm_profile(
            raw_profiles=raw_profiles,
            profile_name=vision_profile_name,
            role="vision",
            model_override_env="VISION_MODEL",
            legacy_model_override_env="VLM_MODEL",
            base_url_override_env="VISION_BASE_URL",
            legacy_base_url_override_env="OPENAI_BASE_URL",
        )
        query_profile = _resolve_vlm_profile(
            raw_profiles=raw_profiles,
            profile_name=query_profile_name,
            role="query",
            model_override_env="QUERY_MODEL",
            legacy_model_override_env=None,
            base_url_override_env="QUERY_BASE_URL",
            legacy_base_url_override_env=None,
        )

        return cls(
            project_root=project_root,
            backend_root=backend_root,
            frontend_root=frontend_root,
            config_path=config_path,
            image_library_dir=image_library_dir,
            db_path=db_path,
            vision_base_url=vision_profile.base_url,
            vision_api_key=vision_profile.api_key,
            vision_model=vision_profile.model,
            vision_provider=vision_profile.provider,
            vision_profile_name=vision_profile.name,
            vision_temperature=vision_profile.temperature,
            vision_max_tokens=vision_profile.max_tokens,
            vision_response_format=vision_profile.response_format,
            query_base_url=query_profile.base_url,
            query_api_key=query_profile.api_key,
            query_model=query_profile.model,
            query_provider=query_profile.provider,
            query_profile_name=query_profile.name,
            query_temperature=query_profile.temperature,
            query_max_tokens=query_profile.max_tokens,
            query_response_format=query_profile.response_format,
            semantic_hints=normalize_semantic_hints(retrieval_config.get("semantic_hints")),
            embedding_backend=os.getenv(
                "EMBEDDING_BACKEND",
                str(embedding_config.get("backend", "dino")),
            ).strip().lower(),
            clip_model_id=str(
                embedding_config.get("clip_model_id", "openai/clip-vit-base-patch32")
            ),
            dino_model_id=str(embedding_config.get("dino_model_id", "facebook/dinov2-base")),
            text_embedding_model_id=os.getenv(
                "TEXT_EMBEDDING_MODEL_ID",
                str(embedding_config.get("text_model_id", "nomic-ai/nomic-embed-text-v2-moe")),
            ),
            text_embedding_query_prefix=os.getenv(
                "TEXT_EMBEDDING_QUERY_PREFIX",
                str(embedding_config.get("text_query_prefix", "search_query: ")),
            ),
            text_embedding_document_prefix=os.getenv(
                "TEXT_EMBEDDING_DOCUMENT_PREFIX",
                str(embedding_config.get("text_document_prefix", "search_document: ")),
            ),
            text_embedding_max_length=int(
                os.getenv(
                    "TEXT_EMBEDDING_MAX_LENGTH",
                    str(embedding_config.get("text_max_length", 512)),
                )
            ),
            geocode_enabled=_as_bool(
                os.getenv("ENABLE_REVERSE_GEOCODE"),
                bool(geocode_config.get("enabled", True)),
            ),
            geocode_user_agent=os.getenv(
                "GEOCODE_USER_AGENT",
                str(geocode_config.get("user_agent", "image-retrieval-local/0.1")),
            ),
            embedding_device=os.getenv(
                "EMBEDDING_DEVICE",
                (
                    str(embedding_config.get("device"))
                    if embedding_config.get("device") is not None
                    else None
                ),
            ),
            text_embedding_device=os.getenv(
                "TEXT_EMBEDDING_DEVICE",
                (
                    str(embedding_config.get("text_device"))
                    if embedding_config.get("text_device") is not None
                    else os.getenv("EMBEDDING_DEVICE")
                ),
            ),
            process_image_width=int(
                os.getenv(
                    "PROCESS_IMAGE_WIDTH",
                    str(app_config.get("process_image_width", 512)),
                )
            ),
        )

    def ensure_directories(self) -> None:
        self.image_library_dir.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)


def _resolve_vlm_profile(
    *,
    raw_profiles: dict[str, Any],
    profile_name: str,
    role: str,
    model_override_env: str,
    legacy_model_override_env: str | None,
    base_url_override_env: str,
    legacy_base_url_override_env: str | None,
) -> VLMProfile:
    if not profile_name:
        raise ValueError(
            f"Config is missing `vlm.{role}_active`, and {role.upper()}_VLM_PROFILE is not set."
        )
    if profile_name not in raw_profiles:
        raise ValueError(
            f"Unknown {role} VLM profile `{profile_name}`. "
            f"Available: {', '.join(sorted(raw_profiles))}"
        )

    raw_profile = raw_profiles[profile_name]
    if not isinstance(raw_profile, dict):
        raise ValueError(f"VLM profile `{profile_name}` must be a mapping.")

    provider = str(raw_profile.get("provider", "openai_compatible")).strip().lower()
    api_key = _resolve_profile_api_key(
        profile_name=profile_name,
        provider=provider,
        raw_profile=raw_profile,
    )
    model = os.getenv(model_override_env)
    if model is None and legacy_model_override_env is not None:
        model = os.getenv(legacy_model_override_env)
    if model is None:
        model = str(raw_profile.get("model", ""))

    base_url = os.getenv(base_url_override_env)
    if base_url is None and legacy_base_url_override_env is not None:
        base_url = os.getenv(legacy_base_url_override_env)
    if base_url is None:
        base_url = str(raw_profile.get("base_url", ""))

    resolved_profile = VLMProfile(
        name=profile_name,
        provider=provider,
        base_url=base_url.rstrip("/"),
        api_key=api_key,
        model=model.strip(),
        temperature=float(raw_profile.get("temperature", 0.1)),
        max_tokens=(
            int(raw_profile["max_tokens"])
            if raw_profile.get("max_tokens") is not None
            else None
        ),
        response_format=(
            raw_profile.get("response_format")
            if isinstance(raw_profile.get("response_format"), dict)
            else {"type": "json_object"}
        ),
    )

    if not resolved_profile.base_url:
        raise ValueError(f"{role.title()} VLM profile `{profile_name}` is missing `base_url`.")
    if not resolved_profile.model:
        raise ValueError(f"{role.title()} VLM profile `{profile_name}` is missing `model`.")
    return resolved_profile


def _resolve_profile_api_key(
    *,
    profile_name: str,
    provider: str,
    raw_profile: dict[str, Any],
) -> str | None:
    api_key_env = raw_profile.get("api_key_env")
    api_key = None
    if isinstance(api_key_env, str) and api_key_env.strip():
        api_key = os.getenv(api_key_env.strip())

    if not api_key and profile_name.startswith("ollama"):
        api_key = os.getenv("OLLAMA_API_KEY")
    if not api_key and provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
    if not api_key and provider == "dashscope":
        api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key and provider == "minimax":
        api_key = os.getenv("MINIMAX_KEY")

    if isinstance(api_key, str):
        api_key = api_key.strip() or None
    return api_key
