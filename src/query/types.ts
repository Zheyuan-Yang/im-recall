export type ToneVariant = "balanced" | "soft";
export type PipelineStatus = "pending" | "active" | "done";
export type DesktopIndexingPhase =
  | "running"
  | "pausing"
  | "paused"
  | "finalizing"
  | "completed";

export interface PromptPreset {
  label: string;
  query: string;
}

export interface PhotoAsset {
  id: string;
  title: string;
  summary: string;
  location: string;
  takenAt: string;
  slot: string;
  concepts: string[];
  surfaceTint: string;
  imageUrl: string;
  score?: number;
}

export interface PipelineStep {
  id: string;
  index: number;
  title: string;
  detail: string;
  metric: string;
  status: PipelineStatus;
}

export interface DraftAnalysis {
  focus: string;
  toneLabel: string;
  timeHint: string;
  useCase: string;
  locationLabel: string;
  tokens: string[];
}

export interface DraftResult {
  id: string;
  prompt: string;
  title: string;
  caption: string;
  candidateCount: number;
  selectedCount: number;
  selected: PhotoAsset[];
  analysis: DraftAnalysis;
  notes: string[];
}

export interface BackendHealth {
  state: "checking" | "connected" | "mock";
  message: string;
  imageLibraryDir?: string;
  dbPath?: string;
}

export interface DesktopFolderSelection {
  folderPath: string;
  dbPath: string;
}

export interface DesktopIndexingStartOptions {
  folderPath: string;
  dbPath?: string;
  apiBase?: string;
  model?: string | null;
  reindex?: boolean;
}

export interface DesktopIndexingProgress {
  phase: DesktopIndexingPhase;
  total: number;
  completed: number;
  indexed: number;
  skipped: number;
  failed: number;
  currentFile: string | null;
  folderPath: string;
  dbPath: string;
  percent: number;
}

export interface DesktopIndexingResult {
  status: "completed";
  folderPath: string;
  dbPath: string;
  total: number;
  indexed: number;
  skipped: number;
  failed: number;
  errors: string[];
}
