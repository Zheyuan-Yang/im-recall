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
  generated_copy?: {
    model: string;
    title: string | null;
    body: string;
    highlights: string[];
    image_count: number;
  } | null;
  data: RetrievalApiImage[];
}

interface FetchDraftOptions {
  apiBase?: string;
  dbPath?: string | null;
  libraryRootPath?: string | null;
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
  libraryRootPath?: string | null,
): PhotoAsset {
  const location = [image.place_name, image.country].filter(Boolean).join(" · ") || "Local library";
  const encodedRelativePath = encodeRelativePath(image.relative_path);
  const imageUrl = libraryRootPath
    ? `${apiBase}/v1/library/files/${encodedRelativePath}?root_path=${encodeURIComponent(libraryRootPath)}`
    : `${apiBase}/v1/library/files/${encodedRelativePath}`;

  return {
    id: image.id,
    title: image.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
    summary: image.description,
    location,
    takenAt: image.taken_at?.slice(0, 10) ?? "unknown",
    slot: inferSlot(image, index),
    concepts: image.tags,
    surfaceTint: SURFACE_TINTS[index % SURFACE_TINTS.length],
    imageUrl,
    score: image.score,
  };
}

function fallbackNotes(images: RetrievalApiImage[]): string[] {
  if (images.length === 0) {
    return [];
  }

  const first = images[0];
  return [
    `The set opens with a stronger lead frame like ${first.filename} to establish the theme quickly.`,
    "The middle introduces detail and space so the sequence does not stay stuck at one viewing distance.",
    "The ending keeps a quieter frame to make the result feel more like a real post-ready set.",
  ];
}

export async function fetchDraftFromBackend(
  prompt: string,
  variant: ToneVariant,
  options: FetchDraftOptions = {},
): Promise<DraftResult | null> {
  const apiBase = options.apiBase ?? "";
  const response = await fetch(`${apiBase}/v1/retrieval/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: prompt,
      top_k: 9,
      db_path: options.dbPath ?? undefined,
      image_library_dir: options.libraryRootPath ?? undefined,
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
  const selected = payload.data.slice(0, 9).map((image, index) =>
    toPhotoAsset(image, index, apiBase, options.libraryRootPath),
  );
  const generatedCopy = payload.generated_copy ?? null;
  const resolvedTitle = payload.title ?? generatedCopy?.title ?? null;
  const resolvedCaption = payload.caption ?? generatedCopy?.body ?? null;
  const resolvedNotes = payload.notes ?? generatedCopy?.highlights ?? null;

  return {
    id: payload.id,
    prompt,
    title:
      resolvedTitle ??
      (variant === "soft" ? "Make the ordinary feel lighter" : "Recent life, arranged with intent"),
    caption:
      resolvedCaption ??
      "Reordering recent photos into a sequence makes the mood and pacing feel much clearer.",
    candidateCount: payload.candidate_count ?? payload.data.length,
    selectedCount: selected.length,
    selected,
    analysis,
    notes:
      resolvedNotes && resolvedNotes.length > 0
        ? resolvedNotes
        : fallbackNotes(payload.data),
  };
}
