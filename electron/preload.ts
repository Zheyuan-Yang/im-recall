import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type {
  DesktopFolderSelection,
  DesktopIndexingProgress,
  DesktopIndexingResult,
  DesktopIndexingStartOptions,
} from "../src/query/types.js";

contextBridge.exposeInMainWorld("memolensDesktop", {
  pickImageFolder(): Promise<DesktopFolderSelection | null> {
    return ipcRenderer.invoke("memolens:pick-image-folder");
  },
  startIndexing(options: DesktopIndexingStartOptions): Promise<DesktopIndexingResult> {
    return ipcRenderer.invoke("memolens:start-indexing", options);
  },
  pauseIndexing(): Promise<boolean> {
    return ipcRenderer.invoke("memolens:pause-indexing");
  },
  resumeIndexing(): Promise<boolean> {
    return ipcRenderer.invoke("memolens:resume-indexing");
  },
  onIndexingProgress(callback: (progress: DesktopIndexingProgress) => void): () => void {
    const listener = (_event: IpcRendererEvent, progress: DesktopIndexingProgress) => {
      callback(progress);
    };
    ipcRenderer.on("memolens:indexing-progress", listener);
    return () => {
      ipcRenderer.removeListener("memolens:indexing-progress", listener);
    };
  },
});
