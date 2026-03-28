import type {
  DesktopFolderSelection,
  DesktopIndexingProgress,
  DesktopIndexingResult,
  DesktopIndexingStartOptions,
} from "./types";

function getDesktopApi() {
  return window.memolensDesktop ?? null;
}

export function isDesktopRuntime(): boolean {
  return getDesktopApi() !== null;
}

export async function pickLocalImageFolder(): Promise<DesktopFolderSelection | null> {
  const api = getDesktopApi();
  if (api === null) {
    return null;
  }
  return api.pickImageFolder();
}

export async function startLocalIndexing(
  options: DesktopIndexingStartOptions,
): Promise<DesktopIndexingResult | null> {
  const api = getDesktopApi();
  if (api === null) {
    return null;
  }
  return api.startIndexing(options);
}

export function subscribeToIndexingProgress(
  callback: (progress: DesktopIndexingProgress) => void,
): (() => void) | null {
  const api = getDesktopApi();
  if (api === null) {
    return null;
  }
  return api.onIndexingProgress(callback);
}
