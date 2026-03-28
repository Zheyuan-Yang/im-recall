import type { DesktopFolderSelection, DesktopIndexingProgress, DesktopIndexingResult, DesktopIndexingStartOptions } from "./query/types";

declare global {
  interface Window {
    memolensDesktop?: {
      pickImageFolder(): Promise<DesktopFolderSelection | null>;
      startIndexing(options: DesktopIndexingStartOptions): Promise<DesktopIndexingResult>;
      pauseIndexing(): Promise<boolean>;
      resumeIndexing(): Promise<boolean>;
      onIndexingProgress(
        callback: (progress: DesktopIndexingProgress) => void,
      ): () => void;
    };
  }
}

export {};
