import { app, BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { LocalIndexStore, type StoredImageRecordTransport } from "./localIndexStore.js";

import type {
  DesktopFolderSelection,
  DesktopIndexingPhase,
  DesktopIndexingProgress,
  DesktopIndexingResult,
  DesktopIndexingStartOptions,
} from "../src/query/types.js";

// Linux dev setups often lack a correctly configured chrome-sandbox helper.
// MemoLens runs as a local desktop tool, so we disable the setuid sandbox here
// to keep the Electron shell usable without extra system-level setup.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-setuid-sandbox");
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".gif",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = dirname(CURRENT_FILE);
const PROJECT_ROOT = resolve(CURRENT_DIR, "..", "..");

interface ActiveIndexingJob {
  sender: WebContents;
  progress: DesktopIndexingProgress;
  pauseRequested: boolean;
  resumeResolvers: Array<() => void>;
}

let activeIndexingJob: ActiveIndexingJob | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1560,
    height: 1040,
    minWidth: 1120,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: join(CURRENT_DIR, "preload.js"),
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    const indexPath = join(PROJECT_ROOT, "dist", "index.html");
    void window.loadURL(pathToFileURL(indexPath).toString());
  }

  return window;
}

async function collectImageFiles(folderPath: string): Promise<string[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(folderPath, entry.name);
      if (entry.isDirectory()) {
        return collectImageFiles(entryPath);
      }
      if (entry.isFile() && SUPPORTED_IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        return [entryPath];
      }
      return [];
    }),
  );
  return nested.flat().sort();
}

function inferMimeType(filePath: string): string {
  return MIME_BY_EXTENSION[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function toRelativePath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join("/");
}

function emitProgress(sender: WebContents, progress: DesktopIndexingProgress): void {
  sender.send("memolens:indexing-progress", progress);
}

function publishJobProgress(
  job: ActiveIndexingJob,
  patch: Partial<DesktopIndexingProgress>,
): DesktopIndexingProgress {
  const nextProgress = {
    ...job.progress,
    ...patch,
  };
  job.progress = nextProgress;
  emitProgress(job.sender, nextProgress);
  return nextProgress;
}

function releaseResumeResolvers(job: ActiveIndexingJob): void {
  const resolvers = [...job.resumeResolvers];
  job.resumeResolvers = [];
  for (const resolve of resolvers) {
    resolve();
  }
}

async function waitIfPaused(job: ActiveIndexingJob): Promise<void> {
  if (!job.pauseRequested) {
    return;
  }

  if (job.progress.phase !== "paused") {
    publishJobProgress(job, {
      phase: "paused",
    });
  }

  await new Promise<void>((resolve) => {
    job.resumeResolvers.push(resolve);
  });
}

function canPausePhase(phase: DesktopIndexingPhase): boolean {
  return phase === "running" || phase === "pausing" || phase === "paused";
}

async function analyzeSingleImage({
  apiBase,
  filePath,
  rootPath,
  model,
}: {
  apiBase: string;
  filePath: string;
  rootPath: string;
  model: string | null;
}): Promise<StoredImageRecordTransport> {
  const content = await readFile(filePath);
  const payload = {
    model,
    persist_to_server: false,
    reindex: true,
    input: {
      image: {
        filename: basename(filePath),
        relative_path: toRelativePath(rootPath, filePath),
        mime_type: inferMimeType(filePath),
        b64: content.toString("base64"),
      },
    },
  };

  const response = await fetch(`${apiBase.replace(/\/$/, "")}/v1/indexing/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as { message?: string; records?: StoredImageRecordTransport[] };
  if (!response.ok) {
    throw new Error(body.message ?? `indexing request failed with status ${response.status}`);
  }

  const record = Array.isArray(body.records) ? body.records[0] : null;
  if (record === null || record === undefined) {
    throw new Error("indexing response did not contain a processed record");
  }
  return record;
}

ipcMain.handle("memolens:pick-image-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select local image folder",
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = resolve(result.filePaths[0]);
  const selection: DesktopFolderSelection = {
    folderPath,
    dbPath: join(folderPath, "photo_index.db"),
  };
  return selection;
});

ipcMain.handle(
  "memolens:start-indexing",
  async (event, options: DesktopIndexingStartOptions): Promise<DesktopIndexingResult> => {
    if (activeIndexingJob !== null) {
      throw new Error("An indexing job is already running. Pause or wait for the current run to finish.");
    }

    const folderPath = resolve(options.folderPath);
    const dbPath = resolve(options.dbPath ?? join(folderPath, "photo_index.db"));
    const apiBase = options.apiBase?.trim() || "http://127.0.0.1:5000";
    const imageFiles = await collectImageFiles(folderPath);
    const store = new LocalIndexStore(dbPath);

    const errors: string[] = [];
    let completed = 0;
    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    const job: ActiveIndexingJob = {
      sender: event.sender,
      progress: {
        phase: "running",
        total: imageFiles.length,
        completed,
        indexed,
        skipped,
        failed,
        currentFile: null,
        folderPath,
        dbPath,
        percent: imageFiles.length === 0 ? 100 : 0,
      },
      pauseRequested: false,
      resumeResolvers: [],
    };
    activeIndexingJob = job;

    publishJobProgress(job, {
      phase: "running",
      total: imageFiles.length,
      completed,
      indexed,
      skipped,
      failed,
      currentFile: null,
      folderPath,
      dbPath,
      percent: imageFiles.length === 0 ? 100 : 0,
    });

    try {
      for (const filePath of imageFiles) {
        await waitIfPaused(job);

        const currentFile = toRelativePath(folderPath, filePath);
        publishJobProgress(job, {
          phase: "running",
          currentFile,
        });

        try {
          const fileBuffer = await readFile(filePath);
          const sha256 = createHash("sha256").update(fileBuffer).digest("hex");

          if (!options.reindex && store.hasSha256(sha256)) {
            skipped += 1;
          } else {
            const record = await analyzeSingleImage({
              apiBase,
              filePath,
              rootPath: folderPath,
              model: options.model ?? null,
            });
            store.upsert(record);
            indexed += 1;
          }
        } catch (error) {
          failed += 1;
          errors.push(`${currentFile}: ${error instanceof Error ? error.message : String(error)}`);
        }

        completed += 1;
        publishJobProgress(job, {
          phase:
            completed >= imageFiles.length ? "finalizing" : job.pauseRequested ? "pausing" : "running",
          completed,
          indexed,
          skipped,
          failed,
          currentFile,
          percent:
            imageFiles.length === 0 ? 100 : Math.round((completed / imageFiles.length) * 100),
        });
      }

      const result: DesktopIndexingResult = {
        status: "completed",
        folderPath,
        dbPath,
        total: imageFiles.length,
        indexed,
        skipped,
        failed,
        errors,
      };
      publishJobProgress(job, {
        phase: "completed",
        completed,
        indexed,
        skipped,
        failed,
        currentFile: null,
        percent: 100,
      });
      return result;
    } finally {
      releaseResumeResolvers(job);
      store.close();
      if (activeIndexingJob === job) {
        activeIndexingJob = null;
      }
    }
  },
);

ipcMain.handle("memolens:pause-indexing", async (): Promise<boolean> => {
  const job = activeIndexingJob;
  if (job === null || !canPausePhase(job.progress.phase)) {
    return false;
  }

  job.pauseRequested = true;
  if (job.progress.phase === "running") {
    publishJobProgress(job, {
      phase: "pausing",
    });
  }
  return true;
});

ipcMain.handle("memolens:resume-indexing", async (): Promise<boolean> => {
  const job = activeIndexingJob;
  if (job === null || !canPausePhase(job.progress.phase)) {
    return false;
  }

  job.pauseRequested = false;
  if (job.progress.phase === "paused" || job.progress.phase === "pausing") {
    publishJobProgress(job, {
      phase: "running",
    });
  }
  releaseResumeResolvers(job);
  return true;
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
