import { useDeferredValue, useEffect, useRef, useState } from "react";

import { fetchDraftFromBackend } from "./query/api";
import {
  isElectronShell,
  isDesktopRuntime,
  pickLocalImageFolder,
  pauseLocalIndexing,
  resumeLocalIndexing,
  startLocalIndexing,
  subscribeToIndexingProgress,
} from "./query/desktop";
import { INITIAL_PROMPT, PROMPT_PRESETS } from "./query/mockLibrary";
import { analyzePrompt, createDraft, createPipelineSteps } from "./query/studio";
import type {
  BackendHealth,
  DesktopIndexingPhase,
  DesktopIndexingProgress,
  DesktopIndexingResult,
  DraftResult,
  PipelineStep,
  ToneVariant,
} from "./query/types";

const PIPELINE_LENGTH = 4;
const GENERATION_STEP_TARGETS = [14, 38, 66, 86];

type DraftGenerationPhase = "idle" | "running" | "completed";

interface DraftGenerationProgressState {
  phase: DraftGenerationPhase;
  percent: number;
  stepIndex: number;
  title: string;
  detail: string;
}

const IDLE_GENERATION_PROGRESS: DraftGenerationProgressState = {
  phase: "idle",
  percent: 0,
  stepIndex: 0,
  title: "等待开始",
  detail: "输入一句话后，系统会先理解需求，再检索、精选，最后生成可直接发的照片组。",
};

function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

function getIndexingPhaseLabel(phase: DesktopIndexingPhase): string {
  switch (phase) {
    case "pausing":
      return "正在暂停";
    case "paused":
      return "已暂停";
    case "finalizing":
      return "收尾中";
    case "completed":
      return "已完成";
    case "running":
    default:
      return "处理中";
  }
}

function getIndexingPhaseMessage(progress: DesktopIndexingProgress): string | null {
  switch (progress.phase) {
    case "pausing":
      return "会在当前这张图片处理完成后暂停。";
    case "paused":
      return "任务已暂停，继续后会从下一张图片接着跑。";
    case "finalizing":
      return "所有图片都已处理完成，正在写入最后结果。";
    default:
      return null;
  }
}

function getGenerationPhaseLabel(phase: DraftGenerationPhase): string {
  switch (phase) {
    case "completed":
      return "已完成";
    case "running":
      return "生成中";
    case "idle":
    default:
      return "待开始";
  }
}

function hasVisibleText(value: string): boolean {
  return value.trim().length > 0;
}

function normalizeDraftForDisplay(
  draft: DraftResult,
  fallbackDraft: DraftResult,
): DraftResult {
  const selected = draft.selected.length > 0 ? draft.selected : fallbackDraft.selected;
  const notes = draft.notes.length > 0 ? draft.notes : fallbackDraft.notes;

  return {
    ...draft,
    candidateCount: draft.candidateCount > 0 ? draft.candidateCount : fallbackDraft.candidateCount,
    title: hasVisibleText(draft.title) ? draft.title : fallbackDraft.title,
    caption: hasVisibleText(draft.caption) ? draft.caption : fallbackDraft.caption,
    selected,
    selectedCount: selected.length,
    notes,
  };
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
  const desktopRuntime = isDesktopRuntime();
  const electronShell = isElectronShell();
  const apiBase =
    import.meta.env.VITE_BACKEND_BASE_URL ??
    (electronShell ? "http://127.0.0.1:5000" : "");
  const [prompt, setPrompt] = useState(INITIAL_PROMPT);
  const [draft, setDraft] = useState<DraftResult>(() => createDraft(INITIAL_PROMPT));
  const [pipeline, setPipeline] = useState<PipelineStep[]>(() =>
    createPipelineSteps(null, 0),
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
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [hasCompletedGeneration, setHasCompletedGeneration] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<DraftGenerationProgressState>(
    IDLE_GENERATION_PROGRESS,
  );
  const [isIndexingControlPending, setIsIndexingControlPending] = useState(false);
  const runIdRef = useRef(0);
  const seedRef = useRef(1);
  const generationProgressTimerRef = useRef<number | null>(null);
  const deferredPrompt = useDeferredValue(prompt);
  const previewAnalysis = analyzePrompt(deferredPrompt || INITIAL_PROMPT);
  const displayDraft = normalizeDraftForDisplay(
    draft,
    createDraft(prompt.trim() || INITIAL_PROMPT, activeVariant, seedRef.current),
  );
  const activeResultDraft =
    health.state === "connected" && !hasCompletedGeneration ? null : displayDraft;

  function clearGenerationProgressTimer(): void {
    if (generationProgressTimerRef.current !== null) {
      window.clearInterval(generationProgressTimerRef.current);
      generationProgressTimerRef.current = null;
    }
  }

  function startGenerationProgressDrift(runId: number): void {
    clearGenerationProgressTimer();
    generationProgressTimerRef.current = window.setInterval(() => {
      if (runIdRef.current !== runId) {
        clearGenerationProgressTimer();
        return;
      }

      setGenerationProgress((current) => {
        if (current.phase !== "running" || current.percent >= 94) {
          clearGenerationProgressTimer();
          return current;
        }

        const nextPercent = Math.min(current.percent + (current.percent < 90 ? 2 : 1), 94);
        if (nextPercent >= 94) {
          clearGenerationProgressTimer();
        }

        return {
          ...current,
          percent: nextPercent,
          detail: "正在把候选照片整理成一组更顺的结果，马上给你最终版本。",
        };
      });
    }, 280);
  }

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
          message: apiBase ? `Backend online · ${apiBase}` : "Local library online",
          imageLibraryDir: payload.image_library_dir,
          dbPath: payload.db_path,
        });
      } catch (error) {
        const reason =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "backend unreachable";
        setHealth({
          state: "mock",
          message: apiBase
            ? `Backend unavailable · ${reason}`
            : "Mock library mode",
        });
      }
    }

    void loadHealth();
    return () => controller.abort();
  }, [apiBase]);

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

  useEffect(() => () => clearGenerationProgressTimer(), []);

  async function runGeneration(variant: ToneVariant): Promise<void> {
    const normalizedPrompt = prompt.trim() || INITIAL_PROMPT;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    clearGenerationProgressTimer();

    setIsGenerating(true);
    setActiveVariant(variant);
    setCopyState("idle");
    setGenerationError(null);

    for (let index = 0; index < PIPELINE_LENGTH; index += 1) {
      const nextPipeline = createPipelineSteps(index, index);
      const activeStep = nextPipeline.find((step) => step.status === "active") ?? nextPipeline[index];
      setPipeline(nextPipeline);
      setGenerationProgress({
        phase: "running",
        percent: GENERATION_STEP_TARGETS[index] ?? 86,
        stepIndex: index + 1,
        title: activeStep.title,
        detail: activeStep.detail,
      });
      await sleep(index === 0 ? 360 : 520);
      if (runIdRef.current !== runId) {
        clearGenerationProgressTimer();
        return;
      }
    }

    seedRef.current += 1;
    startGenerationProgressDrift(runId);
    let nextDraft: DraftResult | null = null;
    if (health.state === "connected") {
      try {
        nextDraft = await fetchDraftFromBackend(normalizedPrompt, variant, {
          apiBase,
          dbPath: selectedDbPath,
          libraryRootPath: selectedFolderPath,
        });
        if (nextDraft === null) {
          setGenerationError("本地库里暂时没有可展示的检索结果，请先确认已经完成 indexing。");
        }
      } catch (error) {
        setGenerationError(
          error instanceof Error ? error.message : "生成照片组失败，暂时无法从本地库取回结果。",
        );
        nextDraft = null;
      }
    }

    if (runIdRef.current !== runId) {
      clearGenerationProgressTimer();
      return;
    }

    if (nextDraft === null && health.state !== "connected") {
      nextDraft = createDraft(normalizedPrompt, variant, seedRef.current);
    }

    if (nextDraft === null) {
      clearGenerationProgressTimer();
      setGenerationProgress({
        phase: "idle",
        percent: 0,
        stepIndex: 0,
        title: "没有生成出可展示结果",
        detail: "先检查本地 indexing 是否完成，或者看一下上面的错误提示。",
      });
      setPipeline(createPipelineSteps(null, 0));
      setIsGenerating(false);
      return;
    }

    clearGenerationProgressTimer();
    setGenerationProgress({
      phase: "completed",
      percent: 100,
      stepIndex: PIPELINE_LENGTH,
      title: "照片组已生成",
      detail: "结果已经准备好，可以直接查看、复制文案，或者继续再来一版。",
    });
    setHasCompletedGeneration(true);
    setDraft(nextDraft);
    setPipeline(createPipelineSteps(null));
    setIsGenerating(false);
  }

  async function handleCopyCaption(): Promise<void> {
    if (!activeResultDraft) {
      return;
    }
    try {
      await navigator.clipboard.writeText(activeResultDraft.caption);
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
    setGenerationError(null);
    setHasCompletedGeneration(false);
  }

  async function handleStartIndexing(): Promise<void> {
    if (!selectedFolderPath) {
      setIndexingError("请先选择一个本地图像文件夹。");
      return;
    }

    setIsIndexing(true);
    setIsIndexingControlPending(false);
    setIndexingError(null);
    setIndexingProgress(null);
    setIndexingResult(null);
    setGenerationError(null);
    setHasCompletedGeneration(false);

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

  async function handlePauseIndexing(): Promise<void> {
    setIndexingError(null);
    setIsIndexingControlPending(true);
    try {
      const paused = await pauseLocalIndexing();
      if (paused === null) {
        setIndexingError("当前浏览器模式不支持暂停本地 indexing，请使用 Electron 运行。");
      }
    } catch (error) {
      setIndexingError(error instanceof Error ? error.message : "暂停 indexing 失败。");
    } finally {
      setIsIndexingControlPending(false);
    }
  }

  async function handleResumeIndexing(): Promise<void> {
    setIndexingError(null);
    setIsIndexingControlPending(true);
    try {
      const resumed = await resumeLocalIndexing();
      if (resumed === null) {
        setIndexingError("当前浏览器模式不支持继续本地 indexing，请使用 Electron 运行。");
      }
    } catch (error) {
      setIndexingError(error instanceof Error ? error.message : "继续 indexing 失败。");
    } finally {
      setIsIndexingControlPending(false);
    }
  }

  const indexingPhase = indexingProgress?.phase ?? null;
  const canPauseIndexing = indexingPhase === "running";
  const canResumeIndexing = indexingPhase === "paused" || indexingPhase === "pausing";
  const canControlIndexing = canPauseIndexing || canResumeIndexing;
  const indexingPhaseMessage = indexingProgress ? getIndexingPhaseMessage(indexingProgress) : null;

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
              {isIndexing && indexingProgress && canControlIndexing ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void (canResumeIndexing ? handleResumeIndexing() : handlePauseIndexing())
                  }
                  disabled={isIndexingControlPending}
                >
                  {canResumeIndexing ? "继续 indexing" : "暂停 indexing"}
                </button>
              ) : null}
              <span className="meta-copy">
                {desktopRuntime
                  ? "Electron main 负责写本地 SQLite"
                  : electronShell
                    ? "Electron 已启动，但本地桥接还没有挂上"
                    : "当前是浏览器模式"}
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
                <strong>
                  {desktopRuntime
                    ? "Electron desktop mode"
                    : electronShell
                      ? "Electron shell without bridge"
                      : "Browser demo mode"}
                </strong>
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
                  <div className="indexing-progress-meta">
                    <span className="analysis-token progress-phase-token">
                      {getIndexingPhaseLabel(indexingProgress.phase)}
                    </span>
                    <span className="analysis-token">{indexingProgress.percent}%</span>
                  </div>
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
                {indexingPhaseMessage ? (
                  <p className="progress-status-note">{indexingPhaseMessage}</p>
                ) : null}
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
                {activeResultDraft
                  ? `${activeResultDraft.candidateCount} candidates → ${activeResultDraft.selectedCount} selected`
                  : "等待这次本地检索的真实结果"}
              </span>
            </div>

            {generationError ? <p className="library-error">{generationError}</p> : null}

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

            <section className="indexing-progress-card generation-progress-card">
              <div className="indexing-progress-head">
                <div>
                  <span className="summary-label">Live Progress</span>
                  <p className="indexing-progress-title">{generationProgress.title}</p>
                </div>
                <div className="indexing-progress-meta">
                  <span className="analysis-token progress-phase-token">
                    {getGenerationPhaseLabel(generationProgress.phase)}
                  </span>
                  <span className="analysis-token">{generationProgress.percent}%</span>
                </div>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${generationProgress.percent}%` }}
                />
              </div>
              <div className="progress-stats">
                <span>
                  {generationProgress.stepIndex > 0
                    ? `阶段 ${generationProgress.stepIndex} / ${PIPELINE_LENGTH}`
                    : "等待新的 prompt"}
                </span>
              </div>
              <p className="progress-current-file">{generationProgress.detail}</p>
            </section>

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
                <p className="result-title">{activeResultDraft?.title ?? "等待生成结果"}</p>
                <p className="result-subtitle">
                  {activeResultDraft
                    ? "selected from your local photo library"
                    : "完成一次真实检索后，这里会显示本地照片结果"}
                </p>
              </div>
              {activeResultDraft ? (
                <div className="result-badges">
                  <span className="analysis-token">{activeResultDraft.analysis.toneLabel}</span>
                  <span className="analysis-token">{activeResultDraft.analysis.focus}</span>
                  <span className="analysis-token">{activeResultDraft.analysis.timeHint}</span>
                </div>
              ) : null}
            </div>

            <section className="caption-card">
              <p>
                {activeResultDraft?.caption ??
                  "还没有拿到本地检索结果。先确认已经完成 indexing，然后再生成一次照片组。"}
              </p>
            </section>

            {activeResultDraft ? (
              <section className="result-grid">
                {activeResultDraft.selected.map((photo, index) => (
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
            ) : null}

            {activeResultDraft ? (
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
                  onClick={() => downloadDraft(activeResultDraft)}
                >
                  导出结果
                </button>
              </div>
            ) : null}

            {activeResultDraft ? (
              <div className="result-notes">
                {activeResultDraft.notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            ) : null}
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
      {(isGenerating || isIndexing) && (
        <div className="floating-state">
          {isIndexing
            ? "indexing local library..."
            : `${generationProgress.title} · ${generationProgress.percent}%`}
        </div>
      )}
    </div>
  );
}

export default App;
