// frontend/src/extract/utils.ts
// Shared helpers for the document extractors.

/** Thrown with a student-friendly message; safe to show directly in the UI. */
export class ExtractionError extends Error {}

/**
 * Normalizes extracted text so it is clean for the LLM and for chunking:
 * unicode ligatures (ﬁ -> fi), odd spaces, stray control characters,
 * trailing spaces, and runaway blank lines. Keeps paragraph breaks ("\n\n").
 */
export function cleanText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u00ad]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
