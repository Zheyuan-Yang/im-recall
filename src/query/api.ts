import { analyzePrompt } from "./studio";
import type { DraftResult, PhotoAsset, ToneVariant } from "./types";

interface RetrievalApiImage {
  id: string;
  filename: string;
  relative_path: string;
  taken_at: string | null;
  place_name: string | null;
  country: string | null;
  description: string;
  tags: string[];
  score: number;
  matched_terms: string[];
}

interface RetrievalApiResponse {
  id: string;
  status: string;
  message: string | null;
  title?: string | null;
  caption?: string | null;
  notes?: string[];
  candidate_count?: number | null;
  data: RetrievalApiImage[];
}

const SURFACE_TINTS = [
  "#d8cdbd",
  "#c6d5ca",
  "#e2d7c9",
  "#c9d0d7",
  "#d9c8c3",
  "#d7d9ce",
  "#cfc5b7",
  "#d9d2c7",
  "#c7d4d0",
];

const SLOT_KEYWORDS: Array<{ slot: string; keywords: string[] }> = [
  { slot: "cover", keywords: ["cover", "hero", "wide", "landscape", "beach", "coast"] },
  { slot: "portrait", keywords: ["portrait", "person", "face"] },
  { slot: "detail", keywords: ["detail", "coffee", "food", "close", "still life"] },
  { slot: "city", keywords: ["city", "street", "skyline", "bridge", "building"] },
  { slot: "walk", keywords: ["walk", "road", "path", "trail"] },
  { slot: "quiet", keywords: ["quiet", "light", "window", "interior", "plant"] },
];

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function inferSlot(image: RetrievalApiImage, index: number): string {
  const searchable = `${image.filename} ${image.description} ${image.tags.join(" ")}`.toLowerCase();
  const matched = SLOT_KEYWORDS.find(({ keywords }) =>
    keywords.some((keyword) => searchable.includes(keyword)),
  );
  if (matched) {
    return matched.slot;
  }

  const fallbackSlots = ["cover", "candid", "detail", "city", "portrait", "quiet", "light", "walk", "still"];
  return fallbackSlots[index % fallbackSlots.length];
}

function toPhotoAsset(
  image: RetrievalApiImage,
  index: number,
  apiBase: string,
): PhotoAsset {
  const location = [image.place_name, image.country].filter(Boolean).join(" · ") || "Local library";

  return {
    id: image.id,
    title: image.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
    summary: image.description,
    location,
    takenAt: image.taken_at?.slice(0, 10) ?? "unknown",
    slot: inferSlot(image, index),
    concepts: image.tags,
    surfaceTint: SURFACE_TINTS[index % SURFACE_TINTS.length],
    imageUrl: `${apiBase}/v1/library/files/${encodeRelativePath(image.relative_path)}`,
    score: image.score,
  };
}

function fallbackNotes(images: RetrievalApiImage[]): string[] {
  if (images.length === 0) {
    return [];
  }

  const first = images[0];
  return [
    `结果从 ${first.filename} 这类更强的主画面起手，先把主题立住。`,
    "中段会混入细节和空间镜头，避免整组都停留在一种取景距离。",
    "尾段保留更安静的画面，让结果更像一组真的准备发布的图集。",
  ];
}

export async function fetchDraftFromBackend(
  prompt: string,
  variant: ToneVariant,
  apiBase = "",
): Promise<DraftResult | null> {
  const response = await fetch(`${apiBase}/v1/retrieval/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: prompt,
      top_k: 9,
    }),
  });

  if (!response.ok) {
    throw new Error(`retrieval query failed with status ${response.status}`);
  }

  const payload = (await response.json()) as RetrievalApiResponse;
  if (payload.status !== "completed" || !Array.isArray(payload.data) || payload.data.length === 0) {
    return null;
  }

  const analysis = analyzePrompt(prompt.toLowerCase());
  const selected = payload.data.slice(0, 9).map((image, index) => toPhotoAsset(image, index, apiBase));

  return {
    id: payload.id,
    prompt,
    title:
      payload.title ??
      (variant === "soft" ? "把普通日子放轻一点" : "认真生活的最近"),
    caption:
      payload.caption ??
      "把最近的照片重新排成一组之后，情绪和顺序都会变得更清楚一些。",
    candidateCount: payload.candidate_count ?? payload.data.length,
    selectedCount: selected.length,
    selected,
    analysis,
    notes: payload.notes && payload.notes.length > 0 ? payload.notes : fallbackNotes(payload.data),
  };
}
