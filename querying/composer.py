from __future__ import annotations

import re

from openai import OpenAI

from core.config import Settings
from core.llm_utils import coerce_json_object, create_openai_client, post_openai_compatible_chat
from core.schemas import RetrievedImageSummary


DRAFT_COMPOSER_PROMPT = """You are composing a polished photo-set draft for a local AI photo curator.

Return ONLY one JSON object with this schema:
{
  "title": "short title, under 16 words",
  "caption": "one polished social-ready caption, 1-3 sentences",
  "notes": [
    "short explanation of what the set emphasizes",
    "short explanation of the pacing or balance",
    "short explanation of why it feels publishable"
  ]
}

Rules:
- Keep the title concise, human, and non-generic.
- Keep the caption warm and natural, not marketing copy.
- Write notes as brief product-facing guidance, not chain-of-thought.
- Avoid markdown.
- Avoid hashtags and emojis unless the user request clearly needs them.
"""


class RetrievalDraftComposer:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: OpenAI | None = None

    def compose(
        self,
        *,
        query_text: str,
        images: list[RetrievedImageSummary],
    ) -> tuple[str | None, str | None, list[str]]:
        if not images:
            return None, None, []

        if not self.settings.text_api_key:
            return self._fallback(query_text=query_text, images=images)

        try:
            content = self._request_content(
                query_text=query_text,
                images=images,
            )
            parsed = coerce_json_object(content)
            title = self._normalize_optional_text(parsed.get("title"))
            caption = self._normalize_optional_text(parsed.get("caption"))
            notes = self._normalize_notes(parsed.get("notes"))
            if title and caption:
                return title, caption, notes
        except Exception:
            pass

        return self._fallback(query_text=query_text, images=images)

    def _request_content(
        self,
        *,
        query_text: str,
        images: list[RetrievedImageSummary],
    ) -> str:
        image_lines = []
        for index, image in enumerate(images[:9], start=1):
            location_parts = [
                part.strip()
                for part in [image.place_name, image.country]
                if isinstance(part, str) and part.strip()
            ]
            location_text = ", ".join(location_parts) if location_parts else "unknown location"
            tag_text = ", ".join(image.tags[:6]) if image.tags else "no tags"
            image_lines.append(
                f"{index}. filename={image.filename}; location={location_text}; "
                f"taken_at={image.taken_at or 'unknown'}; tags={tag_text}; "
                f"description={image.description}"
            )

        messages = [
            {
                "role": "system",
                "content": DRAFT_COMPOSER_PROMPT,
            },
            {
                "role": "user",
                "content": (
                    f"User request: {query_text}\n"
                    "Selected images:\n"
                    + "\n".join(image_lines)
                ),
            },
        ]

        if self.settings.text_provider == "minimax":
            payload: dict[str, object] = {
                "model": self.settings.text_model,
                "temperature": max(0.1, min(1.0, self.settings.text_temperature)),
                "reasoning_split": True,
                "messages": messages,
            }
            if self.settings.text_max_tokens is not None:
                payload["max_tokens"] = self.settings.text_max_tokens
            response = post_openai_compatible_chat(
                api_key=self.settings.text_api_key,
                base_url=self.settings.text_base_url,
                payload=payload,
            )
            return self._extract_response_content(response)

        response = self._get_client().chat.completions.create(
            model=self.settings.text_model,
            temperature=0.2,
            response_format=self.settings.text_response_format,
            max_tokens=self.settings.text_max_tokens,
            messages=messages,
        )
        return str(response.choices[0].message.content or "")

    def _get_client(self) -> OpenAI:
        if self._client is None:
            self._client = create_openai_client(
                api_key=self.settings.text_api_key,
                base_url=self.settings.text_base_url,
            )
        return self._client

    @staticmethod
    def _extract_response_content(response: dict[str, object]) -> str:
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("Chat completion response is missing choices.")

        first_choice = choices[0]
        if not isinstance(first_choice, dict):
            raise ValueError("Chat completion choice must be an object.")

        message = first_choice.get("message")
        if not isinstance(message, dict):
            raise ValueError("Chat completion response is missing a message object.")

        return str(message.get("content") or "")

    @staticmethod
    def _normalize_optional_text(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = re.sub(r"\s+", " ", value.strip())
        return normalized or None

    @classmethod
    def _normalize_notes(cls, value: object) -> list[str]:
        if not isinstance(value, list):
            return []

        notes: list[str] = []
        for item in value:
            normalized = cls._normalize_optional_text(item)
            if normalized and normalized not in notes:
                notes.append(normalized)
        return notes[:3]

    @classmethod
    def _fallback(
        cls,
        *,
        query_text: str,
        images: list[RetrievedImageSummary],
    ) -> tuple[str, str, list[str]]:
        tags: list[str] = []
        locations: list[str] = []
        for image in images:
            for tag in image.tags:
                normalized_tag = re.sub(r"\s+", " ", str(tag).strip().lower())
                if normalized_tag and normalized_tag not in tags:
                    tags.append(normalized_tag)
            for location in [image.place_name, image.country]:
                if isinstance(location, str):
                    normalized_location = re.sub(r"\s+", " ", location.strip())
                    if normalized_location and normalized_location not in locations:
                        locations.append(normalized_location)

        lead_tag = cls._humanize_token(tags[0]) if tags else "Recent"
        second_tag = cls._humanize_token(tags[1]) if len(tags) > 1 else "Moments"
        title = f"{lead_tag} and {second_tag}"

        lead_location = locations[0] if locations else "your library"
        caption = (
            f"From {lead_location}, this set keeps the request centered on {lead_tag.lower()} "
            f"moments and a calmer rhythm. It already feels close to something you could post."
        )

        notes = [
            f"Result stays close to the request: {query_text.strip()}",
            f"Lead images emphasize {lead_tag.lower()} scenes before moving into quieter details.",
            "The sequence balances subject shots, detail shots, and spatial breathing room.",
        ]
        return title, caption, notes

    @staticmethod
    def _humanize_token(token: str) -> str:
        cleaned = re.sub(r"[_\-]+", " ", str(token).strip())
        cleaned = re.sub(r"\s+", " ", cleaned)
        if not cleaned:
            return "Recent"
        return " ".join(word.capitalize() for word in cleaned.split())
