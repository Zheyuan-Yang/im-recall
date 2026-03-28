from __future__ import annotations

import re

from openai import OpenAI

from core.config import Settings
from core.llm_utils import coerce_json_object, create_openai_client
from core.schemas import RetrievalPlan, StructuredRetrievalQuery


QUERY_PLANNER_PROMPT = """You convert natural-language photo search requests into strict JSON
for a local image retrieval system.

Current datetime: {current_datetime}

Return ONLY one JSON object with this schema:
{{
  "can_fulfill": true,
  "reason": null,
  "query": {{
    "top_k": 9,
    "date_from": "ISO8601 or null",
    "date_to": "ISO8601 or null",
    "location_text": "string or null",
    "descriptive_query": "one short caption-like search sentence",
    "required_terms": ["lowercase term"],
    "optional_terms": ["lowercase term"],
    "excluded_terms": ["lowercase term"]
  }}
}}

If the request cannot be converted into a useful retrieval query, return:
{{
  "can_fulfill": false,
  "reason": "Cannot fulfill your request.",
  "query": null
}}

Rules:
- Resolve relative dates like "last December" using the provided current datetime.
- Use ISO8601 timestamps for date_from and date_to.
- Rewrite the request into a short descriptive_query that looks like an image caption or visual search sentence.
- descriptive_query should focus on visible content and scene details, not on conversational wording like "help me find".
- Keep terms short, lowercase, and retrieval-friendly.
- If a phrase is important, keep it as one term if possible.
- Use location_text for place constraints like "San Diego Zoo".
- Never include markdown or extra explanation.
"""


class OpenAICompatibleQueryPlanner:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: OpenAI | None = None

    def plan(
        self,
        text: str,
        current_datetime: str,
        top_k_override: int | None = None,
    ) -> RetrievalPlan:
        if not self.settings.openai_api_key:
            return RetrievalPlan(
                can_fulfill=False,
                reason="Cannot fulfill your request.",
                query=None,
            )

        response = self._get_client().chat.completions.create(
            model=self.settings.vlm_model,
            temperature=0.0,
            response_format=self.settings.vlm_response_format,
            max_tokens=self.settings.vlm_max_tokens,
            messages=[
                {
                    "role": "system",
                    "content": QUERY_PLANNER_PROMPT.format(current_datetime=current_datetime),
                },
                {
                    "role": "user",
                    "content": text,
                },
            ],
        )

        parsed = coerce_json_object(response.choices[0].message.content)
        if not parsed.get("can_fulfill"):
            return RetrievalPlan(
                can_fulfill=False,
                reason="Cannot fulfill your request.",
                query=None,
            )

        raw_query = parsed.get("query")
        if not isinstance(raw_query, dict):
            return RetrievalPlan(
                can_fulfill=False,
                reason="Cannot fulfill your request.",
                query=None,
            )

        top_k = top_k_override if top_k_override is not None else raw_query.get("top_k", 9)
        if not isinstance(top_k, int) or top_k <= 0:
            top_k = 9

        location_text = self._normalize_optional_text(raw_query.get("location_text"))
        descriptive_query = self._normalize_optional_text(raw_query.get("descriptive_query"))
        required_terms = self._normalize_terms(raw_query.get("required_terms"))
        optional_terms = self._normalize_terms(raw_query.get("optional_terms"))
        excluded_terms = self._normalize_terms(raw_query.get("excluded_terms"))
        if descriptive_query is None:
            descriptive_query = self._build_fallback_descriptive_query(
                original_text=text,
                location_text=location_text,
                required_terms=required_terms,
                optional_terms=optional_terms,
            )

        return RetrievalPlan(
            can_fulfill=True,
            reason=None,
            query=StructuredRetrievalQuery(
                top_k=top_k,
                date_from=self._normalize_optional_text(raw_query.get("date_from")),
                date_to=self._normalize_optional_text(raw_query.get("date_to")),
                location_text=location_text,
                descriptive_query=descriptive_query,
                required_terms=required_terms,
                optional_terms=optional_terms,
                excluded_terms=excluded_terms,
            ),
        )

    def _get_client(self) -> OpenAI:
        if self._client is None:
            self._client = create_openai_client(
                api_key=self.settings.openai_api_key,
                base_url=self.settings.openai_base_url,
            )
        return self._client

    @staticmethod
    def _normalize_optional_text(value) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @staticmethod
    def _normalize_terms(value) -> list[str]:
        if not isinstance(value, list):
            return []

        seen: list[str] = []
        for item in value:
            normalized = re.sub(r"\s+", " ", str(item).strip().lower())
            if normalized and normalized not in seen:
                seen.append(normalized)
        return seen

    @staticmethod
    def _build_fallback_descriptive_query(
        *,
        original_text: str,
        location_text: str | None,
        required_terms: list[str],
        optional_terms: list[str],
    ) -> str | None:
        terms = required_terms + [term for term in optional_terms if term not in required_terms]
        if terms:
            caption = f"photo of {' '.join(terms[:8])}"
            if location_text:
                caption += f" at {location_text}"
            return caption

        normalized_text = re.sub(r"\s+", " ", original_text.strip())
        return normalized_text or None
