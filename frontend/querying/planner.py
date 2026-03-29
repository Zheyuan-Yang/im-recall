from __future__ import annotations

from datetime import datetime, timedelta
import re

from openai import OpenAI

from core.config import Settings
from core.llm_utils import (
    coerce_json_object,
    create_openai_client,
    request_minimax_chat_completion,
)
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

Only return:
{{
  "can_fulfill": false,
  "reason": "Cannot fulfill your request.",
  "query": null
}}
when the request is truly unusable for retrieval, such as empty input, pure chit-chat,
or a request with no visual content at all.

Rules:
- Prefer best-effort retrieval queries over rejection.
- Conversational wording is still fulfillable. Rewrite it instead of rejecting it.
- Requests with time, location, and multiple visible constraints are fulfillable.
- Resolve relative dates like "last December" using the provided current datetime.
- Use ISO8601 timestamps for date_from and date_to.
- Rewrite the request into a short descriptive_query that looks like an image caption or visual search sentence.
- descriptive_query should focus on visible content and scene details, not on conversational wording like "help me find".
- Keep terms short, lowercase, and retrieval-friendly.
- If a phrase is important, keep it as one term if possible.
- Use location_text for place constraints like "San Diego Zoo".
- For co-occurrence requests like "pandas as well as other animals", keep the main subject in required_terms and the rest in optional_terms unless exclusion is requested.
- Never include markdown or extra explanation.
"""

LOCAL_QUERY_STOPWORDS = {
    "a",
    "all",
    "an",
    "and",
    "around",
    "at",
    "during",
    "find",
    "for",
    "from",
    "help",
    "i",
    "image",
    "images",
    "in",
    "last",
    "look",
    "looking",
    "me",
    "month",
    "must",
    "my",
    "near",
    "of",
    "on",
    "photo",
    "photos",
    "picture",
    "pictures",
    "please",
    "show",
    "that",
    "the",
    "this",
    "to",
    "today",
    "want",
    "week",
    "with",
    "year",
    "yesterday",
}
LOCAL_EXCLUSION_PATTERN = re.compile(
    r"\b(?:without|excluding|except|not)\s+([a-z0-9-]+(?:\s+[a-z0-9-]+){0,2})",
    re.IGNORECASE,
)
MONTH_NAMES = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]
MONTH_INDEX = {name: index + 1 for index, name in enumerate(MONTH_NAMES)}


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
        if not self.settings.query_api_key:
            return self._fallback_plan(
                text=text,
                current_datetime=current_datetime,
                top_k_override=top_k_override,
            )

        try:
            if self.settings.query_provider == "minimax":
                response = request_minimax_chat_completion(
                    api_key=self.settings.query_api_key,
                    base_url=self.settings.query_base_url,
                    model=self.settings.query_model,
                    temperature=0.0,
                    max_tokens=self.settings.query_max_tokens,
                    response_format=self.settings.query_response_format,
                    messages=[
                        {
                            "role": "system",
                            "content": QUERY_PLANNER_PROMPT.format(
                                current_datetime=current_datetime,
                            ),
                        },
                        {
                            "role": "user",
                            "content": text,
                        },
                    ],
                )
                choices = response.get("choices")
                if not isinstance(choices, list) or not choices:
                    raise RuntimeError("MiniMax response did not contain choices.")
                message = choices[0].get("message") if isinstance(choices[0], dict) else None
                content = message.get("content") if isinstance(message, dict) else None
                parsed = coerce_json_object(content)
            else:
                response = self._get_client().chat.completions.create(
                    model=self.settings.query_model,
                    temperature=0.0,
                    response_format=self.settings.query_response_format,
                    max_tokens=self.settings.query_max_tokens,
                    messages=[
                        {
                            "role": "system",
                            "content": QUERY_PLANNER_PROMPT.format(
                                current_datetime=current_datetime,
                            ),
                        },
                        {
                            "role": "user",
                            "content": text,
                        },
                    ],
                )

                parsed = coerce_json_object(response.choices[0].message.content)
        except Exception:
            return self._fallback_plan(
                text=text,
                current_datetime=current_datetime,
                top_k_override=top_k_override,
            )

        if not parsed.get("can_fulfill"):
            return self._fallback_plan(
                text=text,
                current_datetime=current_datetime,
                top_k_override=top_k_override,
            )

        raw_query = parsed.get("query")
        if not isinstance(raw_query, dict):
            return self._fallback_plan(
                text=text,
                current_datetime=current_datetime,
                top_k_override=top_k_override,
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

        if not required_terms and descriptive_query is None and location_text is None:
            return self._fallback_plan(
                text=text,
                current_datetime=current_datetime,
                top_k_override=top_k_override,
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
                api_key=self.settings.query_api_key,
                base_url=self.settings.query_base_url,
            )
        return self._client

    def _fallback_plan(
        self,
        *,
        text: str,
        current_datetime: str,
        top_k_override: int | None,
    ) -> RetrievalPlan:
        normalized_text = re.sub(r"\s+", " ", text.strip())
        if not normalized_text:
            return RetrievalPlan(
                can_fulfill=False,
                reason="Cannot fulfill your request.",
                query=None,
            )

        reference_datetime = self._parse_current_datetime(current_datetime)
        date_from, date_to = self._extract_date_range(
            text=normalized_text,
            reference_datetime=reference_datetime,
        )
        excluded_terms = self._extract_excluded_terms(normalized_text)
        term_source = self._strip_date_phrases(normalized_text)
        term_source = self._strip_excluded_phrases(term_source)
        location_text = self._extract_location_text(term_source)
        required_terms = self._extract_required_terms(
            text=term_source,
            excluded_terms=excluded_terms,
        )

        if not required_terms and date_from is None and date_to is None and location_text is None:
            return RetrievalPlan(
                can_fulfill=False,
                reason="Cannot fulfill your request.",
                query=None,
            )

        top_k = top_k_override if isinstance(top_k_override, int) and top_k_override > 0 else 9
        descriptive_query = self._build_fallback_descriptive_query(
            original_text=normalized_text,
            location_text=location_text,
            required_terms=required_terms,
            optional_terms=[],
        )

        return RetrievalPlan(
            can_fulfill=True,
            reason=None,
            query=StructuredRetrievalQuery(
                top_k=top_k,
                date_from=date_from,
                date_to=date_to,
                location_text=location_text,
                descriptive_query=descriptive_query,
                required_terms=required_terms,
                optional_terms=[],
                excluded_terms=excluded_terms,
            ),
        )

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

    @staticmethod
    def _parse_current_datetime(current_datetime: str) -> datetime:
        try:
            return datetime.fromisoformat(current_datetime)
        except ValueError:
            return datetime.now().astimezone()

    def _extract_date_range(
        self,
        *,
        text: str,
        reference_datetime: datetime,
    ) -> tuple[str | None, str | None]:
        lowered = text.lower()

        def day_bounds(target: datetime) -> tuple[str, str]:
            start = target.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1) - timedelta(microseconds=1)
            return start.isoformat(), end.isoformat()

        if "today" in lowered or "今天" in text:
            return day_bounds(reference_datetime)
        if "yesterday" in lowered or "昨天" in text:
            return day_bounds(reference_datetime - timedelta(days=1))
        if "last week" in lowered or "最近一周" in text or "上周" in text:
            start = reference_datetime - timedelta(days=7)
            return start.isoformat(), reference_datetime.isoformat()
        if "this month" in lowered:
            start = reference_datetime.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            return start.isoformat(), reference_datetime.isoformat()
        if "最近一个月" in text:
            start = reference_datetime - timedelta(days=30)
            return start.isoformat(), reference_datetime.isoformat()
        if "last month" in lowered or "上个月" in text:
            current_month_start = reference_datetime.replace(
                day=1,
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            previous_month_end = current_month_start - timedelta(microseconds=1)
            previous_month_start = previous_month_end.replace(
                day=1,
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            return previous_month_start.isoformat(), previous_month_end.isoformat()
        if "this year" in lowered or "今年" in text:
            start = reference_datetime.replace(
                month=1,
                day=1,
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            return start.isoformat(), reference_datetime.isoformat()
        if "last year" in lowered or "去年" in text:
            previous_year = reference_datetime.year - 1
            start = reference_datetime.replace(
                year=previous_year,
                month=1,
                day=1,
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            end = reference_datetime.replace(
                year=previous_year,
                month=12,
                day=31,
                hour=23,
                minute=59,
                second=59,
                microsecond=999999,
            )
            return start.isoformat(), end.isoformat()
        if "最近半年" in text:
            start = reference_datetime - timedelta(days=183)
            return start.isoformat(), reference_datetime.isoformat()

        month_match = re.search(
            r"\b(?:(last|this)\s+)?("
            + "|".join(MONTH_NAMES)
            + r")\b(?:\s+of\s+((?:19|20)\d{2}))?",
            lowered,
        )
        if month_match:
            qualifier = month_match.group(1)
            month_name = month_match.group(2)
            explicit_year = month_match.group(3)
            month = MONTH_INDEX[month_name]

            if explicit_year:
                year = int(explicit_year)
            elif qualifier == "last":
                year = reference_datetime.year - (
                    0 if month < reference_datetime.month else 1
                )
            elif qualifier == "this":
                year = reference_datetime.year
            else:
                year = (
                    reference_datetime.year
                    if month <= reference_datetime.month
                    else reference_datetime.year - 1
                )

            start = reference_datetime.replace(
                year=year,
                month=month,
                day=1,
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            if month == 12:
                next_month_start = start.replace(year=year + 1, month=1)
            else:
                next_month_start = start.replace(month=month + 1)
            end = next_month_start - timedelta(microseconds=1)
            return start.isoformat(), end.isoformat()

        explicit_year = re.search(r"\bin\s+((?:19|20)\d{2})\b", lowered)
        if explicit_year:
            year = int(explicit_year.group(1))
            start = reference_datetime.replace(
                year=year,
                month=1,
                day=1,
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            end = reference_datetime.replace(
                year=year,
                month=12,
                day=31,
                hour=23,
                minute=59,
                second=59,
                microsecond=999999,
            )
            return start.isoformat(), end.isoformat()

        explicit_year_cn = re.search(r"((?:19|20)\d{2})年", text)
        if explicit_year_cn:
            year = int(explicit_year_cn.group(1))
            start = reference_datetime.replace(
                year=year,
                month=1,
                day=1,
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            end = reference_datetime.replace(
                year=year,
                month=12,
                day=31,
                hour=23,
                minute=59,
                second=59,
                microsecond=999999,
            )
            return start.isoformat(), end.isoformat()

        return None, None

    @staticmethod
    def _extract_excluded_terms(text: str) -> list[str]:
        excluded_terms: list[str] = []
        for match in LOCAL_EXCLUSION_PATTERN.finditer(text):
            candidate = re.sub(r"\s+", " ", match.group(1).strip().lower())
            if candidate and candidate not in excluded_terms:
                excluded_terms.append(candidate)
        return excluded_terms

    def _strip_date_phrases(self, text: str) -> str:
        stripped = text
        for month_name in MONTH_NAMES:
            stripped = re.sub(
                rf"\b(?:(?:last|this)\s+)?{month_name}(?:\s+of\s+(?:19|20)\d{{2}})?\b",
                " ",
                stripped,
                flags=re.IGNORECASE,
            )

        for pattern in [
            r"\btoday\b",
            r"\byesterday\b",
            r"\blast\s+week\b",
            r"\blast\s+month\b",
            r"\blast\s+year\b",
            r"\bthis\s+month\b",
            r"\bthis\s+year\b",
            r"\bin\s+(19|20)\d{2}\b",
            r"今天",
            r"昨天",
            r"最近半年",
            r"最近一个月",
            r"最近一周",
            r"上周",
            r"上个月",
            r"去年",
            r"今年",
            r"(19|20)\d{2}年",
        ]:
            stripped = re.sub(pattern, " ", stripped, flags=re.IGNORECASE)

        return re.sub(r"\s+", " ", stripped).strip()

    @staticmethod
    def _strip_excluded_phrases(text: str) -> str:
        stripped = LOCAL_EXCLUSION_PATTERN.sub(" ", text)
        return re.sub(r"\s+", " ", stripped).strip()

    @staticmethod
    def _extract_required_terms(
        *,
        text: str,
        excluded_terms: list[str],
    ) -> list[str]:
        excluded_tokens = {
            token
            for phrase in excluded_terms
            for token in re.findall(r"[a-z0-9]+", phrase.lower())
        }
        required_terms: list[str] = []
        for token in re.findall(r"[a-z0-9]+", text.lower()):
            if token in LOCAL_QUERY_STOPWORDS:
                continue
            if token in excluded_tokens:
                continue
            if len(token) <= 1:
                continue
            if token not in required_terms:
                required_terms.append(token)
        return required_terms

    @staticmethod
    def _extract_location_text(text: str) -> str | None:
        cleaned = re.sub(r"\s+", " ", text.strip())
        if not cleaned:
            return None

        match = re.search(
            r"\b(?:in|at|near)\s+([A-Za-z][A-Za-z0-9&'.-]*(?:\s+[A-Za-z][A-Za-z0-9&'.-]*){0,5})"
            r"(?=\s+(?:with|that|which|who|must|need|has|have|containing|including|featuring)\b|[,.!?]|$)",
            cleaned,
            flags=re.IGNORECASE,
        )
        if match:
            candidate = match.group(1).strip()
            if candidate and candidate.lower() not in {"the", "a", "an"}:
                return candidate

        return None
