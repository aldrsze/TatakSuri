// frontend/src/ai/chunks.ts
// Helpers that turn "one long reading + a number of items wanted" into a list of
// small model calls, and run those calls one by one.

import { splitIntoChunks } from './jsonOutput';

// Smaller than the generic 6000 so the prompt, the chunk, and the answer all fit
// in a 4096-token context window.
export const GENERATION_CHUNK_CHARS = 5000;

/** Splits the reading, and if there are too many pieces, samples evenly across it. */
export function selectChunks(text: string, maxChunks = 4): string[] {
  const chunks = splitIntoChunks(text, GENERATION_CHUNK_CHARS);
  if (!chunks.length) throw new Error('The reading has no text.');
  if (chunks.length <= maxChunks) return chunks;
  if (maxChunks <= 1) return [chunks[0]];

  // Always include the first and last parts, spread the rest in between
  return Array.from({ length: maxChunks }, (_, i) =>
    chunks[Math.round((i * (chunks.length - 1)) / (maxChunks - 1))],
  );
}

/** distribute(10, 3) -> [4, 3, 3] */
export function distribute(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface Task {
  chunk: string;
  n: number;
}

/**
 * Plans the model calls needed to produce `count` items: spreads them over the
 * reading, and splits big requests into batches (small models do better with
 * fewer items per call).
 */
export function planTasks(
  text: string,
  count: number,
  opts: { maxChunks: number; maxPerCall: number },
): Task[] {
  const chunks = selectChunks(text, Math.min(opts.maxChunks, count));
  const sizes = distribute(count, chunks.length);
  const tasks: Task[] = [];

  chunks.forEach((chunk, i) => {
    let left = sizes[i];
    while (left > 0) {
      const n = Math.min(opts.maxPerCall, left);
      tasks.push({ chunk, n });
      left -= n;
    }
  });
  return tasks;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/**
 * Runs the calls one after another. If some fail but others succeed, you still
 * get the successes. Only throws if everything failed (or the user cancelled).
 */
export async function runBatches<I, O>(
  inputs: I[],
  run: (input: I) => Promise<O>,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<O[]> {
  const results: O[] = [];
  let firstError: unknown;

  for (let i = 0; i < inputs.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Generation was cancelled.', 'AbortError');
    try {
      results.push(await run(inputs[i]));
    } catch (e) {
      if (opts.signal?.aborted || isAbort(e)) throw e;
      firstError ??= e;
    }
    opts.onProgress?.(i + 1, inputs.length);
  }

  if (!results.length) throw firstError;
  return results;
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Lowercase, no punctuation: used to spot duplicates and to match quotes. */
export const normalizeKey = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
