import { useDeferredValue, useEffect, useRef, useState, useTransition } from "react";

import { fetchDraftFromBackend } from "./query/api";
import {
  isDesktopRuntime,
  pickLocalImageFolder,
  startLocalIndexing,
  subscribeToIndexingProgress,
} from "./query/desktop";
import { INITIAL_PROMPT, PROMPT_PRESETS } from "./query/mockLibrary";
import { analyzePrompt, createDraft, createPipelineSteps } from "./query/studio";
import type {
  BackendHealth,
  DesktopIndexingProgress,
  DesktopIndexingResult,
  DraftResult,
  PipelineStep,
  ToneVariant,
} from "./query/types";

const PIPELINE_LENGTH = 4;

function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

function buildExportContent(draft: DraftResult): string {
  const photoLines = draft.selected
    .map(
      (photo, index) =>
        `${index + 1}. ${photo.title} | ${photo.location} | ${photo.takenAt}`,
    )
    .join("\n");

  return [
    `Title: ${draft.title}`,
    "",
    `Caption: ${draft.caption}`,
    "",
    `Prompt: ${draft.prompt}`,
    "",
    "Selected Photos:",
    photoLines,
  ].join("\n");
}

function downloadDraft(draft: DraftResult): void {
  const blob = new Blob([buildExportContent(draft)], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `memolens-${draft.id}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function App() {
  const apiBase = import.meta.env.VITE_BACKEND_BASE_URL ?? "";
  const desktopRuntime = isDesktopRuntime();
  const [prompt, setPrompt] = useState(INITIAL_PROMPT);
  const [draft, setDraft] = useState<DraftResult>(() => createDraft(INITIAL_PROMPT));
  const [pipeline, setPipeline] = useState<PipelineStep[]>(() =>
    createPipelineSteps(null),
  );
  const [activeVariant, setActiveVariant] = useState<ToneVariant>("balanced");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [health, setHealth] = useState<BackendHealth>({
    state: "checking",
    message: "Checking local backend",
  });
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [selectedDbPath, setSelectedDbPath] = useState<string | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState<DesktopIndexingProgress | null>(null);
  const [indexingResult, setIndexingResult] = useState<DesktopIndexingResult | null>(null);
  const [indexingError, setIndexingError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const runIdRef = useRef(0);
  const seedRef = useRef(1);
  const deferredPrompt = useDeferredValue(prompt);
  const previewAnalysis = analyzePrompt(deferredPrompt || INITIAL_PROMPT);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth(): Promise<void> {
      try {
        const response = await fetch(`${apiBase}/healthz`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`unexpected status ${response.status}`);
        }

        const payload = (await response.json()) as {
          image_library_dir?: string;
          db_path?: string;
        };

        setHealth({
          state: "connected",
          message: "Local library online",
          imageLibraryDir: payload.image_library_dir,
          dbPath: payload.db_path,
        });
      } catch {
        setHealth({
          state: "mock",
          message: "Mock library mode",
        });
      }
    }

    void loadHealth();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToIndexingProgress((progress) => {
      setIndexingProgress(progress);
      setSelectedFolderPath(progress.folderPath);
      setSelectedDbPath(progress.dbPath);
      if (progress.phase === "completed") {
        setIsIndexing(false);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  async function runGeneration(variant: ToneVariant): Promise<void> {
    const normalizedPrompt = prompt.trim() || INITIAL_PROMPT;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    setIsGenerating(true);
    setActiveVariant(variant);
    setCopyState("idle");

    for (let index = 0; index < PIPELINE_LENGTH; index += 1) {
      setPipeline(createPipelineSteps(index, index));
      await sleep(index === 0 ? 360 : 520);
      if (runIdRef.current !== runId) {
        return;
      }
    }

    seedRef.current += 1;
    let nextDraft: DraftResult | null = null;
    if (health.state === "connected") {
      try {
        nextDraft = await fetchDraftFromBackend(normalizedPrompt, variant, apiBase);
      } catch {
        nextDraft = null;
      }
    }

    if (runIdRef.current !== runId) {
      return;
    }

    if (nextDraft === null) {
      nextDraft = createDraft(normalizedPrompt, variant, seedRef.current);
    }

    startTransition(() => {
      setDraft(nextDraft);
      setPipeline(createPipelineSteps(null));
    });
    setIsGenerating(false);
  }

  async function handleCopyCaption(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draft.caption);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1600);
    }
  }

  function appendPreset(query: string): void {
    setPrompt((currentPrompt) => {
      if (!currentPrompt.trim()) {
        return query;
      }
      if (currentPrompt.includes(query)) {
        return currentPrompt;
      }
      const trimmed = currentPrompt.trim().replace(/[。.!?？]+$/, "");
      return `${trimmed}，${query}`;
    });
  }

  async function handlePickFolder(): Promise<void> {
    setIndexingError(null);
    const selection = await pickLocalImageFolder();
    if (!selection) {
      return;
    }
    setSelectedFolderPath(selection.folderPath);
    setSelectedDbPath(selection.dbPath);
    setIndexingResult(null);
    setIndexingProgress(null);
  }

  async function handleStartIndexing(): Promise<void> {
    if (!selectedFolderPath) {
      setIndexingError("请先选择一个本地图像文件夹。");
      return;
    }

    setIsIndexing(true);
    setIndexingError(null);
    setIndexingResult(null);

    try {
      const result = await startLocalIndexing({
        folderPath: selectedFolderPath,
        dbPath: selectedDbPath ?? undefined,
        apiBase: apiBase || "http://127.0.0.1:5000",
      });
      if (result === null) {
        setIndexingError("当前浏览器模式不支持本地 SQLite，请使用 Electron 运行。");
        setIsIndexing(false);
        return;
      }
      setIndexingResult(result);
      setSelectedFolderPath(result.folderPath);
      setSelectedDbPath(result.dbPath);
      setHealth((currentHealth) => ({
        ...currentHealth,
        dbPath: result.dbPath,
      }));
    } catch (error) {
      setIndexingError(error instanceof Error ? error.message : "本地 indexing 失败。");
      setIsIndexing(false);
    }
  }

  return (
    <div className="page-shell">
      <main className="app-frame">
        <header className="topbar">
          <div className="brand-block">
            <div className="brand-mark">M</div>
            <div>
              <p className="brand-name">MemoLens</p>
              <p className="brand-meta">AI Photo Curator</p>
            </div>
          </div>
          <nav className="nav-links" aria-label="Primary">
            <a href="#composer">Product</a>
            <a href="#pipeline">Flow</a>
            <a href="#result">Result</a>
          </nav>
          <div className="topbar-actions">
            <span className={`health-pill health-${health.state}`}>
              <span className="status-dot" />
              {health.message}
            </span>
            <a className="primary-button" href="#composer">
              Try draft studio
            </a>
          </div>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Ready-to-post visual stories</p>
            <h1>
              把你的照片库，
              <span>整理成一组可以直接发出去的故事。</span>
            </h1>
            <p className="hero-description">
              用一句话描述想要的感觉。MemoLens
              会理解语气、检索图片、精选顺序，再补上一句已经足够像成品的文案。
            </p>
          </div>

          <aside className="hero-summary">
            <div className="summary-card">
              <span className="summary-label">当前偏向</span>
              <strong>{previewAnalysis.focus}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">结果语气</span>
              <strong>{previewAnalysis.toneLabel}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">使用场景</span>
              <strong>{previewAnalysis.useCase}</strong>
            </div>
          </aside>
        </section>

        <section className="library-workbench" id="library">
          <article className="panel library-panel">
            <div className="panel-head">
              <p className="panel-label">Local Library</p>
              <p className="panel-title">从这台笔记本本地选图，再逐张送给 Flask 做 indexing</p>
            </div>

            <div className="library-actions">
              <button className="primary-button" type="button" onClick={() => void handlePickFolder()}>
                选择本地文件夹
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void handleStartIndexing()}
                disabled={!desktopRuntime || !selectedFolderPath || isIndexing}
              >
                {isIndexing ? "Indexing..." : "开始建立本地索引"}
              </button>
              <span className="meta-copy">
                {desktopRuntime ? "Electron main 负责写本地 SQLite" : "当前是浏览器模式"}
              </span>
            </div>

            <div className="library-grid">
              <div className="summary-card">
                <span className="summary-label">图片文件夹</span>
                <strong>{selectedFolderPath ?? "还没有选择"}</strong>
              </div>
              <div className="summary-card">
                <span className="summary-label">本地数据库</span>
                <strong>{selectedDbPath ?? "将写入 photo_index.db"}</strong>
              </div>
              <div className="summary-card">
                <span className="summary-label">运行方式</span>
                <strong>{desktopRuntime ? "Electron desktop mode" : "Browser demo mode"}</strong>
              </div>
            </div>

            <div className="library-note">
              <span className="summary-label">当前策略</span>
              <p>
                图片保留在本地文件夹里，前端逐张把文件传给 Flask 做视觉理解和 embedding，
                本地 SQLite 再把结果写进同一个文件夹下的 `photo_index.db`。
              </p>
            </div>

            {indexingProgress ? (
              <section className="indexing-progress-card">
                <div className="indexing-progress-head">
                  <div>
                    <span className="summary-label">Indexing Progress</span>
                    <p className="indexing-progress-title">
                      {indexingProgress.completed} / {indexingProgress.total} 已处理
                    </p>
                  </div>
                  <span className="analysis-token">{indexingProgress.percent}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${indexingProgress.percent}%` }}
                  />
                </div>
                <div className="progress-stats">
                  <span>indexed {indexingProgress.indexed}</span>
                  <span>skipped {indexingProgress.skipped}</span>
                  <span>failed {indexingProgress.failed}</span>
                </div>
                <p className="progress-current-file">
                  当前文件: {indexingProgress.currentFile ?? "准备中"}
                </p>
              </section>
            ) : null}

            {indexingResult ? (
              <div className="result-notes library-result">
                <p>
                  已完成 {indexingResult.total} 张图的本地 indexing，其中
                  `indexed {indexingResult.indexed}`，`skipped {indexingResult.skipped}`，
                  `failed {indexingResult.failed}`。
                </p>
                <p>SQLite 已写入: {indexingResult.dbPath}</p>
              </div>
            ) : null}

            {indexingError ? <p className="library-error">{indexingError}</p> : null}
          </article>
        </section>

        <section className="workspace">
          <article className="panel composer-panel" id="composer">
            <div className="panel-head">
              <p className="panel-label">Prompt</p>
              <p className="panel-title">一句话描述你想发的那组照片</p>
            </div>

            <div className="chip-row">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  className="chip"
                  type="button"
                  onClick={() => appendPreset(preset.query)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <label className="textarea-shell">
              <span className="sr-only">Prompt input</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void runGeneration(activeVariant);
                  }
                }}
                placeholder="比如：帮我从最近的照片里挑 9 张适合发朋友圈的，整体温柔一点，再给我一句文案。"
              />
            </label>

            <div className="composer-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => void runGeneration("balanced")}
                disabled={isGenerating}
              >
                {isGenerating && activeVariant === "balanced"
                  ? "Generating..."
                  : "生成图集草稿"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void runGeneration("soft")}
                disabled={isGenerating}
              >
                {isGenerating && activeVariant === "soft" ? "Refining..." : "更柔和一点"}
              </button>
              <span className="meta-copy">
                {draft.candidateCount} candidates → {draft.selectedCount} selected
              </span>
            </div>

            <div className="composer-meta">
              <div>
                <span className="summary-label">适合场景</span>
                <p>创作者日记 / 回忆图集 / 社交发布草稿</p>
              </div>
              <div>
                <span className="summary-label">输出内容</span>
                <p>9 张图、标题、顺序建议和一条可复制文案</p>
              </div>
            </div>

            <div className="composer-note">
              <span className="summary-label">本次解析</span>
              <div className="token-row">
                {previewAnalysis.tokens.map((token) => (
                  <span className="analysis-token" key={token}>
                    {token}
                  </span>
                ))}
              </div>
              <p>
                {previewAnalysis.locationLabel} · {previewAnalysis.timeHint} ·
                快捷键 `Cmd/Ctrl + Enter`
              </p>
            </div>
          </article>

          <article className="panel pipeline-panel" id="pipeline">
            <div className="panel-head">
              <p className="panel-label">Pipeline</p>
              <p className="panel-title">让用户感觉系统真的在工作</p>
            </div>

            <div className="pipeline-list">
              {pipeline.map((step) => (
                <section
                  className={`pipeline-step status-${step.status}`}
                  key={step.id}
                >
                  <div className="pipeline-index">{String(step.index).padStart(2, "0")}</div>
                  <div className="pipeline-copy">
                    <h3>{step.title}</h3>
                    <p>{step.detail}</p>
                    <span>{step.metric}</span>
                  </div>
                </section>
              ))}
            </div>

            <div className="pipeline-caption">
              <span className="summary-label">当前模式</span>
              <p>
                {activeVariant === "soft"
                  ? "Softer curation: 提高柔和、安静和留白的权重。"
                  : "Balanced curation: 保持人物、细节和场景之间的节奏。"}
              </p>
            </div>
          </article>

          <article className="panel result-panel" id="result">
            <div className="panel-head result-head">
              <div>
                <p className="panel-label">Ready-to-post result</p>
                <p className="result-title">{draft.title}</p>
                <p className="result-subtitle">selected from your local photo library</p>
              </div>
              <div className="result-badges">
                <span className="analysis-token">{draft.analysis.toneLabel}</span>
                <span className="analysis-token">{draft.analysis.focus}</span>
                <span className="analysis-token">{draft.analysis.timeHint}</span>
              </div>
            </div>

            <section className="caption-card">
              <p>{draft.caption}</p>
            </section>

            <section className="result-grid">
              {draft.selected.map((photo, index) => (
                <article
                  className="photo-card"
                  key={photo.id}
                  style={{ backgroundColor: photo.surfaceTint }}
                >
                  <img src={photo.imageUrl} alt={photo.title} />
                  <div className="photo-overlay">
                    {index === 0 ? <span className="hero-tag">Hero</span> : null}
                    <div className="photo-meta">
                      <strong>{photo.title}</strong>
                      <span>{photo.slot}</span>
                    </div>
                  </div>
                </article>
              ))}
            </section>

            <div className="result-actions">
              <button className="primary-button" type="button" onClick={() => void handleCopyCaption()}>
                {copyState === "copied"
                  ? "已复制文案"
                  : copyState === "failed"
                    ? "复制失败"
                    : "复制文案"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void runGeneration("soft")}
                disabled={isGenerating}
              >
                更柔和一点
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => downloadDraft(draft)}
              >
                导出结果
              </button>
            </div>

            <div className="result-notes">
              {draft.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </article>
        </section>

        <footer className="footer">
          <p>Designed as a premium AI publishing assistant, not a photo search dashboard.</p>
          <p>
            {selectedDbPath
              ? `Local DB: ${selectedDbPath}`
              : health.state === "connected" && health.imageLibraryDir
                ? `Library: ${health.imageLibraryDir}`
              : "Frontend demo is ready for real retrieval integration."}
          </p>
        </footer>
      </main>
      {(isGenerating || isPending || isIndexing) && (
        <div className="floating-state">
          {isIndexing ? "indexing local library..." : "curating draft..."}
        </div>
      )}
    </div>
  );
}

export default App;
