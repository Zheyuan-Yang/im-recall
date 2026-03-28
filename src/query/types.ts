export type ToneVariant = "balanced" | "soft";
export type PipelineStatus = "pending" | "active" | "done";

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

