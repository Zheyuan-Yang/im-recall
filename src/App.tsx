import { useDeferredValue, useEffect, useRef, useState, useTransition } from "react";

import { fetchDraftFromBackend } from "./query/api";
import { INITIAL_PROMPT, PROMPT_PRESETS } from "./query/mockLibrary";
import { analyzePrompt, createDraft, createPipelineSteps } from "./query/studio";
import type { BackendHealth, DraftResult, PipelineStep, ToneVariant } from "./query/types";

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
            {health.state === "connected" && health.imageLibraryDir
              ? `Library: ${health.imageLibraryDir}`
              : "Frontend demo is ready for real retrieval integration."}
          </p>
        </footer>
      </main>
      {(isGenerating || isPending) && <div className="floating-state">curating draft...</div>}
    </div>
  );
}

export default App;
