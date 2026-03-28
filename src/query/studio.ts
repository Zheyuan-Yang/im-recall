import { INITIAL_PROMPT, PHOTO_LIBRARY } from "./mockLibrary";
import type {
  DraftAnalysis,
  DraftResult,
  PhotoAsset,
  PipelineStep,
  ToneVariant,
} from "./types";

const PIPELINE_BLUEPRINT = [
  {
    id: "understand",
    title: "理解需求",
    detail: "识别场景、主角、时间范围和整体语气",
    metric: "tone + intent",
  },
  {
    id: "retrieve",
    title: "检索图片库",
    detail: "按语义、标签和拍摄线索组合召回候选",
    metric: "semantic + metadata",
  },
  {
    id: "curate",
    title: "精选 9 张",
    detail: "去重、平衡节奏，保留最像一组的画面",
    metric: "score + diversity",
  },
  {
    id: "compose",
    title: "生成文案",
    detail: "补出标题、顺序和一条可直接复制的 caption",
    metric: "title + caption",
  },
];

const KEYWORD_GROUPS: Record<string, string[]> = {
  soft: ["温柔", "柔和", "soft", "gentle", "softer"],
  daily: ["日常", "daily", "生活", "vlog", "普通日子"],
  memory: ["回忆", "memory", "纪念", "recent", "最近", "近半年"],
  quiet: ["安静", "quiet", "别太热闹", "不要太热闹", "calm"],
  city: ["城市", "street", "city", "downtown"],
  portrait: ["某个人", "人物", "portrait", "一个人", "主角"],
  friends: ["朋友", "friends", "聚会", "一起"],
  coast: ["海边", "coast", "ocean", "beach", "海"],
  coffee: ["咖啡", "coffee", "cafe"],
  walk: ["散步", "walk", "走路", "路上"],
  light: ["光", "光线", "window", "sunlight", "亮一点"],
  sunset: ["日落", "sunset", "傍晚", "golden hour"],
  travel: ["旅行", "travel", "roadtrip", "假期", "度假"],
  losangeles: ["洛杉矶", "los angeles", "la"],
  social: ["朋友圈", "发图", "post", "publish", "社交"],
};

function hasKeyword(prompt: string, key: string): boolean {
  const keywords = KEYWORD_GROUPS[key];
  if (!keywords) {
    return false;
  }
  return keywords.some((keyword) => prompt.includes(keyword));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word) =>
      word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

export function createPipelineSteps(
  activeIndex: number | null,
  completedCount = PIPELINE_BLUEPRINT.length,
): PipelineStep[] {
  return PIPELINE_BLUEPRINT.map((step, index) => ({
    ...step,
    index: index + 1,
    status:
      index < completedCount
        ? "done"
        : activeIndex === index
          ? "active"
          : "pending",
  }));
}

export function analyzePrompt(rawPrompt: string): DraftAnalysis {
  const prompt = rawPrompt.trim().toLowerCase();
  const focusTokens = Object.keys(KEYWORD_GROUPS).filter((key) =>
    hasKeyword(prompt, key),
  );

  const locationLabel = hasKeyword(prompt, "losangeles")
    ? "洛杉矶附近"
    : hasKeyword(prompt, "coast")
      ? "海边或沿途"
      : "本地图集";

  const toneLabel = hasKeyword(prompt, "soft")
    ? "柔和叙事"
    : hasKeyword(prompt, "quiet")
      ? "安静克制"
      : hasKeyword(prompt, "memory")
        ? "回忆感"
        : "平衡自然";

  const focus = hasKeyword(prompt, "portrait")
    ? "人物主导"
    : hasKeyword(prompt, "friends")
      ? "关系感主导"
      : hasKeyword(prompt, "coast")
        ? "海边叙事"
        : hasKeyword(prompt, "city")
          ? "城市日常"
          : "生活切片";

  const useCase = hasKeyword(prompt, "social")
    ? "社交发布草稿"
    : hasKeyword(prompt, "memory")
      ? "回忆图集"
      : "内容精选";

  const timeHint =
    prompt.includes("最近半年") || prompt.includes("半年")
      ? "最近半年"
      : prompt.includes("最近")
        ? "最近一段时间"
        : prompt.includes("去年")
          ? "去年"
          : "不限时间";

  return {
    focus,
    toneLabel,
    timeHint,
    useCase,
    locationLabel,
    tokens: dedupe(
      focusTokens.map((token) =>
        token === "social" ? "publishable" : titleCase(token),
      ),
    ).slice(0, 5),
  };
}

function scorePhoto(
  photo: PhotoAsset,
  analysis: DraftAnalysis,
  prompt: string,
  variant: ToneVariant,
  seed: number,
): number {
  let score = 8;

  for (const concept of photo.concepts) {
    if (hasKeyword(prompt, concept)) {
      score += 4.2;
    }
  }

  if (analysis.focus === "人物主导" && photo.concepts.includes("portrait")) {
    score += 3.4;
  }
  if (analysis.focus === "关系感主导" && photo.concepts.includes("friends")) {
    score += 3.2;
  }
  if (analysis.focus === "海边叙事" && photo.concepts.includes("coast")) {
    score += 3.4;
  }
  if (analysis.focus === "城市日常" && photo.concepts.includes("city")) {
    score += 3;
  }

  if (analysis.toneLabel === "柔和叙事") {
    if (
      photo.concepts.some((concept) =>
        ["soft", "quiet", "light", "memory"].includes(concept),
      )
    ) {
      score += 2.8;
    }
  }

  if (analysis.toneLabel === "安静克制" && photo.concepts.includes("quiet")) {
    score += 2.6;
  }

  if (analysis.locationLabel === "洛杉矶附近" && photo.concepts.includes("losangeles")) {
    score += 1.8;
  }

  if (variant === "soft") {
    if (
      photo.concepts.some((concept) =>
        ["soft", "quiet", "light", "warm"].includes(concept),
      )
    ) {
      score += 2.4;
    }
    if (photo.concepts.includes("city")) {
      score -= 0.6;
    }
  }

  const jitter = (hashString(`${photo.id}-${seed}`) % 17) / 10;
  return score + jitter;
}

function selectDiversePhotos(sortedPhotos: PhotoAsset[]): PhotoAsset[] {
  const selected: PhotoAsset[] = [];
  const seenSlots = new Set<string>();

  for (const photo of sortedPhotos) {
    if (!seenSlots.has(photo.slot)) {
      selected.push(photo);
      seenSlots.add(photo.slot);
    }
    if (selected.length === 9) {
      return selected;
    }
  }

  for (const photo of sortedPhotos) {
    if (!selected.some((item) => item.id === photo.id)) {
      selected.push(photo);
    }
    if (selected.length === 9) {
      break;
    }
  }

  return selected;
}

function buildTitle(analysis: DraftAnalysis, variant: ToneVariant): string {
  if (analysis.focus === "人物主导") {
    return variant === "soft" ? "一个人的轻声日常" : "把一个人的最近排成一组";
  }
  if (analysis.focus === "关系感主导") {
    return variant === "soft" ? "和朋友一起的轻时刻" : "一些刚刚好的陪伴";
  }
  if (analysis.focus === "海边叙事") {
    return variant === "soft" ? "风从海边慢慢吹过来" : "沿海那几天的光";
  }
  if (analysis.focus === "城市日常") {
    return variant === "soft" ? "城市里安静的一段" : "认真生活的最近";
  }

  return variant === "soft" ? "把普通日子放轻一点" : "认真生活的最近";
}

function buildCaption(analysis: DraftAnalysis, variant: ToneVariant): string {
  if (analysis.focus === "人物主导") {
    return variant === "soft"
      ? "最近想留下来的，不是特别大的事件，只是一些人和光线刚好都很温柔的瞬间。把这些轻轻排在一起，好像就更接近那段真实的心情。"
      : "把一个人的最近整理成一组，原来普通的走路、停顿和发呆，也会慢慢长出叙事感。";
  }

  if (analysis.focus === "关系感主导") {
    return variant === "soft"
      ? "和喜欢的人待在一起时，很多画面其实都不需要解释。笑一下、坐一会儿、晒一点太阳，就已经足够被记住。"
      : "把朋友之间那些不需要刻意摆拍的时刻留下来，热闹刚刚好，松弛也刚刚好。";
  }

  if (analysis.focus === "海边叙事") {
    return variant === "soft"
      ? "海风、路边、傍晚和一点点慢下来的心情，拼起来就是这组最近最想留下来的画面。"
      : "沿海那几天没有太多安排，但光线和空气都很好，刚好够拼成一组能直接发出去的小故事。";
  }

  if (analysis.toneLabel === "柔和叙事") {
    return "一个人在这边慢慢生活，也把普通日子过成了值得记录的样子。光线、散步、咖啡和安静的傍晚，刚好拼成这一组最近想留下来的心情。";
  }

  if (analysis.toneLabel === "安静克制") {
    return "挑掉那些太满的画面之后，留下来的反而更像真正想记住的部分。安静一点，也更耐看一点。";
  }

  return "把最近的照片重新排成一组之后，才发现真正留下来的，不是事件本身，而是那些让人想再看一眼的情绪。";
}

function buildNotes(analysis: DraftAnalysis, selected: PhotoAsset[]): string[] {
  const narrative = selected.slice(0, 3).map((photo) => photo.title).join(" / ");
  const slotMix = dedupe(selected.map((photo) => photo.slot)).join(" + ");

  return [
    `叙事起点偏向 ${analysis.focus}，前排画面会更强调 ${narrative}。`,
    `这组结果保持 ${analysis.toneLabel}，避免把所有照片都做成同一种取景。`,
    `当前排序覆盖 ${slotMix}，更像一组真的准备发布的图集。`,
  ];
}

export function createDraft(
  rawPrompt = INITIAL_PROMPT,
  variant: ToneVariant = "balanced",
  seed = 1,
): DraftResult {
  const prompt = rawPrompt.trim() || INITIAL_PROMPT;
  const normalizedPrompt = prompt.toLowerCase();
  const analysis = analyzePrompt(normalizedPrompt);

  const rankedPhotos = PHOTO_LIBRARY.map((photo) => ({
    ...photo,
    score: scorePhoto(photo, analysis, normalizedPrompt, variant, seed),
  })).sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  const selected = selectDiversePhotos(rankedPhotos).map((photo, index) => ({
    ...photo,
    score: Number(((photo.score ?? 0) - index * 0.18).toFixed(2)),
  }));

  return {
    id: `draft-${seed}`,
    prompt,
    title: buildTitle(analysis, variant),
    caption: buildCaption(analysis, variant),
    candidateCount: 108 + analysis.tokens.length * 7 + (variant === "soft" ? 11 : 0),
    selectedCount: selected.length,
    selected,
    analysis,
    notes: buildNotes(analysis, selected),
  };
}
