from __future__ import annotations

import base64
import re

from openai import OpenAI

from core.config import Settings
from core.llm_utils import coerce_json_object, create_openai_client
from core.schemas import VisionMetadata
from .files import PreparedImage


VISION_PROMPT = """Analyze this photo for local image retrieval.
Return strict JSON with this shape:
{
  "tags": ["short tag", "short tag"],
  "description": "1-2 sentence factual description of the image content",
  "location_hint": "specific landmark/location hint or null"
}

Rules:
- Keep tags concise and lowercase.
- Prefer visually-grounded nouns and attributes.
- Only fill location_hint when the image contains a very recognizable landmark or explicit readable sign.
- If there is a strong location cue, prefer returning the landmark or place name in location_hint instead of omitting it.
- Prefer the most specific visually-supported landmark or venue name you can justify from the image itself.
- Do not guess a city, region, or country from weak cues like weather, architecture style, or vegetation alone.
- If you are not confident, set location_hint to null.
- Do not include markdown.
- Do not mention uncertainty unless the image is genuinely unclear.
"""


class OpenAICompatibleVisionClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: OpenAI | None = None

    def describe_image(
        self,
        prepared_image: PreparedImage,
        model: str,
    ) -> VisionMetadata:
        if not self.settings.openai_api_key:
            return self._fallback_metadata(prepared_image.source_name)

        payload = {
            "model": model,
            "temperature": self.settings.vlm_temperature,
            "response_format": self.settings.vlm_response_format,
            "messages": [
                {
                    "role": "system",
                    "content": [{"type": "text", "text": VISION_PROMPT}],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Generate tags and a short description for this image.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": self._to_data_url(
                                    content_bytes=prepared_image.content_bytes,
                                    mime_type=prepared_image.mime_type,
                                ),
                                "detail": "low",
                            },
                        },
                    ],
                },
            ],
        }

        response = self._get_client().chat.completions.create(
            model=payload["model"],
            temperature=payload["temperature"],
            response_format=payload["response_format"],
            messages=payload["messages"],
            max_tokens=self.settings.vlm_max_tokens,
        )

        content = response.choices[0].message.content
        parsed = coerce_json_object(content)

        tags = parsed.get("tags", [])
        description = str(parsed.get("description", "")).strip()
        location_hint = parsed.get("location_hint")

        if not isinstance(tags, list):
            tags = []

        cleaned_tags = []
        for tag in tags:
            normalized = re.sub(r"\s+", " ", str(tag).strip().lower())
            if normalized and normalized not in cleaned_tags:
                cleaned_tags.append(normalized)

        if not description:
            description = self._fallback_metadata(prepared_image.source_name).description

        normalized_location_hint = None
        if location_hint is not None:
            candidate_hint = re.sub(r"\s+", " ", str(location_hint).strip())
            if candidate_hint and candidate_hint.lower() not in {"null", "none", "unknown"}:
                normalized_location_hint = candidate_hint

        return VisionMetadata(
            tags=cleaned_tags[:12] or self._fallback_metadata(prepared_image.source_name).tags,
            description=description,
            location_hint=normalized_location_hint,
        )

    def _get_client(self) -> OpenAI:
        if self._client is None:
            self._client = create_openai_client(
                api_key=self.settings.openai_api_key,
                base_url=self.settings.openai_base_url,
            )
        return self._client

    @staticmethod
    def _to_data_url(content_bytes: bytes, mime_type: str) -> str:
        encoded = base64.b64encode(content_bytes).decode("utf-8")
        return f"data:{mime_type};base64,{encoded}"

    @staticmethod
    def _fallback_metadata(name: str) -> VisionMetadata:
        stem_tokens = re.split(r"[_\-\s]+", name.lower())
        tags = [token for token in stem_tokens if token][:6]
        return VisionMetadata(
            tags=tags or ["untagged"],
            description=f"Local image file named {name}.",
            location_hint=None,
        )
