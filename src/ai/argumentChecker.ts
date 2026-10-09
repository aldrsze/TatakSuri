// frontend/src/ai/argumentChecker.ts
// Finds assumptions, missing perspectives, and weak arguments / fallacies in a reading.

import { generateJson } from './jsonOutput';
import { normalizeKey, runBatches, selectChunks } from './chunks';
import { ARGUMENT_CHECKER_SYSTEM, argumentCheckerUser } from './prompts';

export interface WeakArgument {
  passage: string; // exact quote from the reading, or '' if the model's quote could not be verified
  problem: string;
  fallacy: string; // e.g. "hasty generalization", or ''
}

export interface ArgumentCheckResult {
  mainClaim: string;
  assumptions: string[];
  missingPerspectives: string[];
  weakArguments: WeakArgument[];
}

const MAX_ITEMS = 6;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, MAX_ITEMS) : [];
}

/**
 * Builds a validator for one chunk. Quotes the model "found" are checked against the
 * chunk text; if a quote is not really in the reading it is dropped (so the UI never
 * shows an invented quote as if the author wrote it).
 */
function validatorFor(chunk: string) {
  const haystack = normalizeKey(chunk);

  const quoteExists = (passage: string) =>
    passage
      .split(/\.{3}|…/)
      .map(normalizeKey)
      .filter((piece) => piece.length > 5)
      .every((piece) => haystack.includes(piece));

  return (data: unknown): ArgumentCheckResult => {
    const d = data as any;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Expected a JSON object.');

    const weakArguments: WeakArgument[] = (Array.isArray(d.weakArguments) ? d.weakArguments : [])
      .map((w: any) => {
        const passage = str(w?.passage).replace(/^["“']|["”']$/g, '');
        return {
          passage: passage && quoteExists(passage) ? passage : '',
          problem: str(w?.problem),
          fallacy: str(w?.fallacy).toLowerCase(),
        };
      })
      .filter((w: WeakArgument) => w.problem)
      .slice(0, MAX_ITEMS);

    const result: ArgumentCheckResult = {
      mainClaim: str(d.mainClaim),
      assumptions: stringList(d.assumptions),
      missingPerspectives: stringList(d.missingPerspectives),
      weakArguments,
    };

    const empty =
      !result.mainClaim &&
      !result.assumptions.length &&
      !result.missingPerspectives.length &&
      !result.weakArguments.length;
    if (empty) throw new Error('The analysis was empty.');
    return result;
  };
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = normalizeKey(key(item));
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function checkArguments(opts: {
  text: string;
  maxChunks?: number; // how many parts of a long reading to analyze (default 3)
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<ArgumentCheckResult> {
  const chunks = selectChunks(opts.text, opts.maxChunks ?? 3);

  const parts = await runBatches(
    chunks,
    (chunk) =>
      generateJson({
        system: ARGUMENT_CHECKER_SYSTEM,
        user: argumentCheckerUser(chunk),
        validate: validatorFor(chunk),
        maxTokens: 1000,
        signal: opts.signal,
      }),
    { onProgress: opts.onProgress, signal: opts.signal },
  );

  return {
    mainClaim: parts.map((p) => p.mainClaim).find(Boolean) ?? '',
    assumptions: dedupe(parts.flatMap((p) => p.assumptions), (s) => s).slice(0, MAX_ITEMS),
    missingPerspectives: dedupe(parts.flatMap((p) => p.missingPerspectives), (s) => s).slice(0, MAX_ITEMS),
    weakArguments: dedupe(parts.flatMap((p) => p.weakArguments), (w) => w.problem).slice(0, MAX_ITEMS),
  };
}
