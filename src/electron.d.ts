import type { DesktopFolderSelection, DesktopIndexingProgress, DesktopIndexingResult, DesktopIndexingStartOptions } from "./query/types";

declare global {
  interface Window {
    memolensDesktop?: {
      pickImageFolder(): Promise<DesktopFolderSelection | null>;
      startIndexing(options: DesktopIndexingStartOptions): Promise<DesktopIndexingResult>;
      onIndexingProgress(
        callback: (progress: DesktopIndexingProgress) => void,
      ): () => void;
    };
  }
}

export {};
