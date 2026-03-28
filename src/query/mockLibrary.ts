import type { PhotoAsset, PromptPreset } from "./types";

interface ArtworkPalette {
  sky: string;
  glow: string;
  horizon: string;
  ground: string;
  ink: string;
}

interface MockPhotoSeed {
  id: string;
  title: string;
  summary: string;
  location: string;
  takenAt: string;
  slot: string;
  concepts: string[];
  surfaceTint: string;
  palette: ArtworkPalette;
}

function buildArtworkDataUrl(
  title: string,
  slot: string,
  palette: ArtworkPalette,
): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="640" viewBox="0 0 800 640">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${palette.sky}" />
          <stop offset="54%" stop-color="${palette.glow}" />
          <stop offset="100%" stop-color="${palette.horizon}" />
        </linearGradient>
      </defs>
      <rect width="800" height="640" rx="42" fill="url(#bg)" />
      <circle cx="620" cy="154" r="94" fill="${palette.glow}" opacity="0.72" />
      <path d="M0 408 C134 346 226 320 332 338 C412 352 486 392 584 394 C666 396 728 364 800 314 V640 H0 Z" fill="${palette.horizon}" opacity="0.75" />
      <path d="M0 468 C140 444 236 406 340 426 C450 446 562 534 800 484 V640 H0 Z" fill="${palette.ground}" opacity="0.9" />
      <rect x="34" y="34" width="132" height="40" rx="20" fill="rgba(255,255,255,0.26)" />
      <text x="100" y="60" text-anchor="middle" font-family="Manrope, sans-serif" font-size="18" font-weight="700" fill="${palette.ink}">
        ${slot.toUpperCase()}
      </text>
      <rect x="34" y="534" width="732" height="72" rx="24" fill="rgba(255,255,255,0.3)" />
      <text x="64" y="582" font-family="Manrope, sans-serif" font-size="34" font-weight="700" fill="${palette.ink}">
        ${title}
      </text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const PHOTO_SEEDS: MockPhotoSeed[] = [
  {
    id: "photo-window-pause",
    title: "Window Pause",
    summary: "柔和的窗边光线，让人看起来像正在认真度过普通的一天。",
    location: "洛杉矶 · Silver Lake",
    takenAt: "2026-02-14",
    slot: "cover",
    concepts: ["soft", "daily", "portrait", "window", "quiet", "losangeles"],
    surfaceTint: "#d8cdbd",
    palette: {
      sky: "#f0dfcf",
      glow: "#f7efe6",
      horizon: "#cdbda8",
      ground: "#9f8f77",
      ink: "#2a221c",
    },
  },
  {
    id: "photo-coffee-counter",
    title: "Coffee Pause",
    summary: "杯子、桌角和一点留白，很适合当作图集里的停顿。",
    location: "洛杉矶 · Echo Park",
    takenAt: "2026-02-17",
    slot: "detail",
    concepts: ["coffee", "soft", "detail", "daily", "quiet", "losangeles"],
    surfaceTint: "#ddd2c3",
    palette: {
      sky: "#e4d5c6",
      glow: "#f7eee4",
      horizon: "#d0bead",
      ground: "#8f7a66",
      ink: "#2b231d",
    },
  },
  {
    id: "photo-neighborhood-walk",
    title: "Neighborhood Walk",
    summary: "街区散步的背影和树影，画面很轻，但有行进感。",
    location: "洛杉矶 · Los Feliz",
    takenAt: "2026-02-19",
    slot: "walk",
    concepts: ["walk", "daily", "city", "quiet", "light", "losangeles"],
    surfaceTint: "#d9d2c7",
    palette: {
      sky: "#dce4dc",
      glow: "#eff4ee",
      horizon: "#c5d1c3",
      ground: "#7b8b79",
      ink: "#253126",
    },
  },
  {
    id: "photo-evening-tram",
    title: "Evening Rail",
    summary: "一点傍晚蓝调和城市线条，适合给图集加一个呼吸位。",
    location: "洛杉矶 · Downtown",
    takenAt: "2026-01-31",
    slot: "city",
    concepts: ["city", "evening", "quiet", "blue", "travel", "losangeles"],
    surfaceTint: "#c9d0d7",
    palette: {
      sky: "#cad6e6",
      glow: "#e8edf4",
      horizon: "#a8b5c8",
      ground: "#66758f",
      ink: "#1d2733",
    },
  },
  {
    id: "photo-film-portrait",
    title: "Soft Portrait",
    summary: "近景人物有一点胶片气息，像记忆里会留下来的那张。",
    location: "洛杉矶 · Koreatown",
    takenAt: "2026-02-11",
    slot: "portrait",
    concepts: ["portrait", "soft", "memory", "daily", "person", "losangeles"],
    surfaceTint: "#d9c8c3",
    palette: {
      sky: "#e5d1cf",
      glow: "#f2e7e6",
      horizon: "#d6bbb9",
      ground: "#926d6c",
      ink: "#331f22",
    },
  },
  {
    id: "photo-stair-light",
    title: "Light on Stairs",
    summary: "简单的结构和落下来的光线，让整组画面更干净。",
    location: "洛杉矶 · Pasadena",
    takenAt: "2026-02-08",
    slot: "light",
    concepts: ["light", "detail", "quiet", "architecture", "daily", "losangeles"],
    surfaceTint: "#d7d7ce",
    palette: {
      sky: "#ede8d9",
      glow: "#faf7ee",
      horizon: "#d3ccbc",
      ground: "#8c8678",
      ink: "#2d2a22",
    },
  },
  {
    id: "photo-house-plants",
    title: "Morning Plants",
    summary: "植物和晨光会让结果更有生活感，也不至于太单调。",
    location: "洛杉矶 · Highland Park",
    takenAt: "2026-02-05",
    slot: "quiet",
    concepts: ["home", "soft", "quiet", "daily", "light", "losangeles"],
    surfaceTint: "#c7d4d0",
    palette: {
      sky: "#dce8e1",
      glow: "#eef5f0",
      horizon: "#c4d5cc",
      ground: "#6e887f",
      ink: "#203028",
    },
  },
  {
    id: "photo-diner-candid",
    title: "Late Lunch",
    summary: "带一点人物互动的生活瞬间，会让图集不只是风景。",
    location: "洛杉矶 · Glendale",
    takenAt: "2026-02-03",
    slot: "candid",
    concepts: ["daily", "friends", "person", "warm", "city", "losangeles"],
    surfaceTint: "#d9d2c7",
    palette: {
      sky: "#f0d8c5",
      glow: "#f7eadc",
      horizon: "#d0b89d",
      ground: "#936c4b",
      ink: "#342417",
    },
  },
  {
    id: "photo-coast-drive",
    title: "Coastline Drive",
    summary: "如果 prompt 带一点放松或回忆感，这张能拉开叙事空间。",
    location: "马里布 · Pacific Coast Highway",
    takenAt: "2026-01-24",
    slot: "cover",
    concepts: ["coast", "travel", "memory", "soft", "blue", "sunset"],
    surfaceTint: "#c6d5ca",
    palette: {
      sky: "#d7e2e7",
      glow: "#edf4f7",
      horizon: "#b7d0d6",
      ground: "#66848e",
      ink: "#1e2d33",
    },
  },
  {
    id: "photo-sea-breeze",
    title: "Sea Breeze",
    summary: "偏安静的海边细节，适合放在中后段给情绪降一点速。",
    location: "圣塔莫尼卡 · Ocean Front",
    takenAt: "2026-01-22",
    slot: "detail",
    concepts: ["coast", "quiet", "detail", "light", "memory", "travel"],
    surfaceTint: "#d6dfdf",
    palette: {
      sky: "#d9e7e6",
      glow: "#eef6f5",
      horizon: "#bfd8d6",
      ground: "#779391",
      ink: "#203436",
    },
  },
  {
    id: "photo-golden-hour-road",
    title: "Golden Hour Road",
    summary: "有一点远方感，但不会太满，适合做叙事转场。",
    location: "橙县 · Laguna",
    takenAt: "2026-01-18",
    slot: "walk",
    concepts: ["travel", "sunset", "warm", "light", "road", "memory"],
    surfaceTint: "#d8c7b6",
    palette: {
      sky: "#ead5be",
      glow: "#f8eddc",
      horizon: "#d9b999",
      ground: "#9a704d",
      ink: "#362417",
    },
  },
  {
    id: "photo-bookstore",
    title: "Bookstore Quiet",
    summary: "偏静物和空间感的镜头，能让结果像被认真编排过。",
    location: "洛杉矶 · Arts District",
    takenAt: "2026-02-12",
    slot: "quiet",
    concepts: ["quiet", "daily", "detail", "warm", "city", "losangeles"],
    surfaceTint: "#cfbfae",
    palette: {
      sky: "#e1cfbf",
      glow: "#f4ebdf",
      horizon: "#c8b39f",
      ground: "#866e59",
      ink: "#2d231d",
    },
  },
  {
    id: "photo-rooftop-night",
    title: "Roofline Blue",
    summary: "夜色不吵，只留下城市的轮廓和一点风。",
    location: "洛杉矶 · Hollywood",
    takenAt: "2026-02-02",
    slot: "city",
    concepts: ["city", "quiet", "blue", "night", "memory", "losangeles"],
    surfaceTint: "#c3cbd7",
    palette: {
      sky: "#c3cfdf",
      glow: "#dde6f0",
      horizon: "#a5b0c9",
      ground: "#59647f",
      ink: "#1b2235",
    },
  },
  {
    id: "photo-friends-picnic",
    title: "Picnic Hour",
    summary: "有朋友但不喧闹，适合“热闹一点点但别太满”的请求。",
    location: "洛杉矶 · Griffith Park",
    takenAt: "2026-02-21",
    slot: "candid",
    concepts: ["friends", "warm", "daily", "soft", "nature", "losangeles"],
    surfaceTint: "#d2d5c2",
    palette: {
      sky: "#dce4cd",
      glow: "#edf3df",
      horizon: "#c4cfaa",
      ground: "#75815e",
      ink: "#28301f",
    },
  },
  {
    id: "photo-sunshade",
    title: "Sunshade Detail",
    summary: "明暗对比比较轻，适合把整组结果收得更高级一些。",
    location: "洛杉矶 · Venice",
    takenAt: "2026-01-28",
    slot: "detail",
    concepts: ["detail", "light", "soft", "architecture", "coast", "losangeles"],
    surfaceTint: "#ddd0c1",
    palette: {
      sky: "#ead9c7",
      glow: "#f7eee2",
      horizon: "#d1bea8",
      ground: "#8e7d6a",
      ink: "#30261f",
    },
  },
  {
    id: "photo-courtyard",
    title: "Courtyard Noon",
    summary: "空间、树影和中性配色，很适合中段承接前后画面。",
    location: "洛杉矶 · Pasadena",
    takenAt: "2026-02-07",
    slot: "light",
    concepts: ["architecture", "light", "quiet", "daily", "city", "losangeles"],
    surfaceTint: "#d6d0c4",
    palette: {
      sky: "#e8dfd0",
      glow: "#f5efe5",
      horizon: "#d8ccbb",
      ground: "#8d7f6d",
      ink: "#302921",
    },
  },
];

export const PHOTO_LIBRARY: PhotoAsset[] = PHOTO_SEEDS.map((photo) => ({
  id: photo.id,
  title: photo.title,
  summary: photo.summary,
  location: photo.location,
  takenAt: photo.takenAt,
  slot: photo.slot,
  concepts: photo.concepts,
  surfaceTint: photo.surfaceTint,
  imageUrl: buildArtworkDataUrl(photo.title, photo.slot, photo.palette),
}));

export const PROMPT_PRESETS: PromptPreset[] = [
  { label: "朋友圈图集", query: "适合发朋友圈" },
  { label: "温柔一点", query: "整体温柔一点" },
  { label: "日常感", query: "有一点认真生活的日常感" },
  { label: "某个人", query: "以某个人为主角" },
  { label: "最近半年", query: "从最近半年里选" },
  { label: "别太热闹", query: "不要太热闹" },
];

export const INITIAL_PROMPT =
  "帮我从最近的照片里挑 9 张适合发朋友圈的，整体温柔一点，有日常感，不要太热闹，再给我一句文案。";

