from __future__ import annotations

import json
import re
from importlib import import_module
from importlib.metadata import PackageNotFoundError, version

from openai import OpenAI
import requests


def strip_wrapping_fences(text: str) -> str:
    stripped = text.strip()

    fence_patterns = (
        (r"^```(?:json)?\s*", r"\s*```$"),
        (r"^'''(?:json)?\s*", r"\s*'''$"),
    )

    for prefix_pattern, suffix_pattern in fence_patterns:
        if re.match(prefix_pattern, stripped, re.IGNORECASE) and re.search(
            suffix_pattern, stripped
        ):
            stripped = re.sub(prefix_pattern, "", stripped, count=1, flags=re.IGNORECASE)
            stripped = re.sub(suffix_pattern, "", stripped, count=1)
            return stripped.strip()

    return stripped


def coerce_json_object(content) -> dict[str, object]:
    if isinstance(content, list):
        text_parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(str(item.get("text", "")))
        content = "\n".join(text_parts)

    text = strip_wrapping_fences(str(content).strip())

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("LLM returned non-JSON content.")
        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError("LLM did not return a JSON object.")
    return parsed


def create_openai_client(*, api_key: str | None, base_url: str) -> OpenAI:
    try:
        return OpenAI(
            api_key=api_key,
            base_url=base_url,
        )
    except TypeError as exc:
        if "unexpected keyword argument 'proxies'" not in str(exc):
            raise

        openai_version = _safe_version("openai")
        httpx_version = _safe_version("httpx")
        raise RuntimeError(
            "Incompatible OpenAI SDK stack detected "
            f"(openai={openai_version}, httpx={httpx_version}). "
            "Reinstall from `requirements.txt` or pin `httpx<0.28`."
        ) from exc


def request_minimax_chat_completion(
    *,
    api_key: str | None,
    base_url: str,
    model: str,
    messages: list[dict[str, object]],
    temperature: float | None,
    max_tokens: int | None,
    response_format: dict[str, object] | None = None,
) -> dict[str, object]:
    if not api_key:
        raise RuntimeError("MINIMAX_KEY is not set.")

    payload: dict[str, object] = {
        "model": model,
        "messages": messages,
    }
    if temperature is not None:
        payload["temperature"] = temperature
    if max_tokens is not None:
        payload["max_completion_tokens"] = max_tokens
    if response_format:
        payload["response_format"] = response_format

    response = requests.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    if response.status_code >= 400:
        raise RuntimeError(
            f"MiniMax request failed ({response.status_code}): {response.text[:500]}"
        )

    try:
        parsed = response.json()
    except ValueError as exc:
        raise RuntimeError(
            f"MiniMax returned non-JSON content: {response.text[:500]}"
        ) from exc

    if not isinstance(parsed, dict):
        raise RuntimeError("MiniMax response is not a JSON object.")
    return parsed


def _safe_version(package_name: str) -> str:
    try:
        module = import_module(package_name)
        module_version = getattr(module, "__version__", None)
        if isinstance(module_version, str) and module_version.strip():
            return module_version
    except Exception:
        pass

    try:
        return version(package_name)
    except PackageNotFoundError:
        return "unknown"
