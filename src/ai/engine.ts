// frontend/src/ai/engine.ts
// Singleton wrapper around WebLLM: WebGPU check, model loading with progress,
// a status store React can subscribe to, and queued (one-at-a-time) generation.
// Requires: npm install @mlc-ai/web-llm

import {
  CreateWebWorkerMLCEngine,
  hasModelInCache,
  prebuiltAppConfig,
  type ChatCompletionMessageParam,
  type InitProgressReport,
  type MLCEngineInterface,
} from '@mlc-ai/web-llm';

export type { ChatCompletionMessageParam };

/* ------------------------------- Models ------------------------------- */

// Smaller = faster to download and generate; bigger = better quizzes.
// IDs must exist in WebLLM's prebuilt list; getAvailableModels() filters out
// any that your installed web-llm version doesn't ship.
export const MODEL_OPTIONS = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Tiny (Qwen 2.5 0.5B)' },
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', label: 'Fast, compatible (Llama 3.2 1B, f32)' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Fast (Llama 3.2 1B)' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Balanced (Qwen 2.5 1.5B)' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Better quality (Llama 3.2 3B)' },
] as const;

export const DEFAULT_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

const MODEL_STORAGE_KEY = 'tataksuri.model';

export function getAvailableModels() {
  const known = new Set(prebuiltAppConfig.model_list.map((m) => m.model_id));
  return MODEL_OPTIONS.filter((m) => known.has(m.id));
}

export function getSelectedModelId(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL_ID;
  } catch {
    return DEFAULT_MODEL_ID;
  }
}

export function setSelectedModelId(id: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, id);
  } catch {
    /* storage unavailable, ignore */
  }
}

/** True if the model files are already downloaded (needed for offline use). */
export function isModelCached(modelId = getSelectedModelId()) {
  return hasModelInCache(modelId);
}

/* ------------------------------- Status ------------------------------- */

export type AiStatus =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: string }
  | { state: 'loading'; progress: number; text: string } // progress 0..1
  | { state: 'ready'; modelId: string }
  | { state: 'error'; message: string };

let status: AiStatus = { state: 'idle' };
const listeners = new Set<() => void>();

function setStatus(next: AiStatus) {
  status = next; // new object each time so useSyncExternalStore sees the change
  listeners.forEach((l) => l());
}

export const getStatus = () => status;

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ------------------------------ WebGPU check ------------------------------ */

export async function checkWebGpu(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const gpu = (navigator as any).gpu;
  if (!gpu) {
    return {
      ok: false,
      reason: 'This browser does not support WebGPU. Use a recent Chrome or Edge on a desktop or laptop.',
    };
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'No compatible GPU was found for WebGPU.' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'WebGPU could not be started on this device.' };
  }
}

/* ----------------------------- Load / unload ----------------------------- */

let engine: MLCEngineInterface | null = null;
let worker: Worker | null = null;
let loadedModelId: string | null = null;
let loading: Promise<void> | null = null;

function onProgress(report: InitProgressReport) {
  setStatus({ state: 'loading', progress: report.progress, text: report.text });
}

/**
 * Loads (downloads on first run, then reads from cache) the chosen model.
 * Safe to call repeatedly: concurrent calls share one load, and an already
 * loaded model returns immediately.
 */
export async function loadModel(modelId: string = getSelectedModelId()): Promise<void> {
  if (engine && loadedModelId === modelId) return;

  if (loading) {
    await loading.catch(() => {});
    return loadModel(modelId);
  }

  loading = (async () => {
    try {
      const support = await checkWebGpu();
      if (!support.ok) {
        setStatus({ state: 'unsupported', reason: support.reason });
        throw new Error(support.reason);
      }

      setStatus({ state: 'loading', progress: 0, text: 'Starting…' });

      if (engine) {
        engine.setInitProgressCallback(onProgress);
        await engine.reload(modelId); // switch models on the existing worker
      } else {
        worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        engine = await CreateWebWorkerMLCEngine(worker, modelId, {
          initProgressCallback: onProgress,
        });
      }

      loadedModelId = modelId;
      setSelectedModelId(modelId);
      setStatus({ state: 'ready', modelId });
    } catch (err) {
      if (isGpuLost(err)) {
        markEngineLost();
      } else {
        // A failed first load leaves no usable engine, so drop the worker too
        if (!engine && worker) {
          worker.terminate();
          worker = null;
        }
        if (status.state !== 'unsupported') {
          setStatus({
            state: 'error',
            message: err instanceof Error ? err.message : 'Failed to load the AI model.',
          });
        }
      }
      throw err;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

export async function unloadModel() {
  if (engine) {
    await engine.unload();
    loadedModelId = null;
    setStatus({ state: 'idle' });
  }
}

function requireEngine(): MLCEngineInterface {
  if (!engine || !loadedModelId) {
    throw new Error('The AI model is not loaded yet. Call loadModel() first.');
  }
  return engine;
}

/* --------------------------- GPU loss recovery --------------------------- */

// Windows can reset the GPU if one operation takes too long (DXGI_ERROR_DEVICE_HUNG),
// or the browser can lose the device when memory runs out. The engine is dead after that.
function isGpuLost(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /device (was )?lost|DXGI|device hung|GPUDevice/i.test(msg);
}

function markEngineLost() {
  worker?.terminate();
  worker = null;
  engine = null;
  loadedModelId = null;
  setStatus({
    state: 'error',
    message:
      'The GPU stopped responding. Choose a smaller model and load it again. If it keeps happening, reload the page and close other GPU-heavy apps.',
  });
}

/* ------------------------------ Generation ------------------------------ */

// The local model handles one request at a time, so we queue them.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(() => task());
  queue = run.catch(() => {});
  return run;
}

function abortError() {
  return new DOMException('Generation was cancelled.', 'AbortError');
}

interface BaseOptions {
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CompleteOptions extends BaseOptions {
  /** Constrain output to a JSON object (use for quiz / flashcard / argument JSON). */
  json?: boolean;
  /** Clear cached conversation state first. Default true; fine for stateless tasks. */
  resetChat?: boolean;
}

/** One-shot, non-streaming completion. Returns the full reply text. */
export function complete(opts: CompleteOptions): Promise<string> {
  return enqueue(async () => {
    const e = requireEngine();
    if (opts.signal?.aborted) throw abortError();

    const onAbort = () => e.interruptGenerate();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      if (opts.resetChat !== false) await e.resetChat();
      const reply = await e.chat.completions.create({
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1024,
        stream: false,
        ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
      });
      if (opts.signal?.aborted) throw abortError();
      return reply.choices[0]?.message?.content ?? '';
    } catch (err) {
      if (isGpuLost(err)) markEngineLost();
      throw err;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
  });
}

export interface StreamOptions extends BaseOptions {
  /** Called for every new piece of text; `full` is everything so far. */
  onToken?: (token: string, full: string) => void;
}

/** Streaming chat for Reading Buddy. Resolves with the full reply. */
export function streamChat(opts: StreamOptions): Promise<string> {
  return enqueue(async () => {
    const e = requireEngine();
    if (opts.signal?.aborted) throw abortError();

    const onAbort = () => e.interruptGenerate();
    opts.signal?.addEventListener('abort', onAbort);
    try {
      const stream = await e.chat.completions.create({
        messages: opts.messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 512,
        stream: true,
      });

      let full = '';
      for await (const chunk of stream) {
        if (opts.signal?.aborted) break;
        const token = chunk.choices[0]?.delta?.content ?? '';
        if (token) {
          full += token;
          opts.onToken?.(token, full);
        }
      }
      if (opts.signal?.aborted) throw abortError();
      return full;
    } catch (err) {
      if (isGpuLost(err)) markEngineLost();
      throw err;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
  });
}