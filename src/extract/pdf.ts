// frontend/src/extract/pdf.ts
// PDF text extraction with pdf.js. Returns one string per page.
// Requires: npm install pdfjs-dist

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ExtractionError, median } from './utils';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface RawItem {
  str: string;
  transform: number[]; // [a, b, c, d, x, y]
  height: number;
}

async function openPdf(file: File) {
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (err: any) {
    if (err?.name === 'PasswordException') {
      throw new ExtractionError('This PDF is password-protected. Remove the password and try again.');
    }
    throw new ExtractionError('This PDF could not be read. The file may be damaged.');
  }
}

/**
 * pdf.js gives loose text fragments with positions. We group them into lines by
 * their y position, then start a new paragraph wherever the vertical gap is
 * noticeably bigger than normal line spacing. This keeps "\n\n" paragraph breaks
 * so long readings can be chunked cleanly later.
 */
function pageToText(items: unknown[]): string {
  const lines: { text: string; y: number }[] = [];
  let cur: { text: string; y: number } | null = null;

  for (const it of items as RawItem[]) {
    if (typeof it?.str !== 'string' || !it.transform) continue;
    const y = it.transform[5];
    const tol = Math.max(2, (it.height || 10) * 0.4);
    const sameLine = cur !== null && Math.abs(y - cur.y) <= tol;

    if (sameLine) {
      cur!.text += it.str;
    } else if (it.str.trim()) {
      if (cur) lines.push(cur);
      cur = { text: it.str, y };
    }
  }
  if (cur) lines.push(cur);

  const clean = lines
    .map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), y: l.y }))
    .filter((l) => l.text);
  if (!clean.length) return '';

  const gaps = clean.slice(1).map((l, i) => clean[i].y - l.y).filter((g) => g > 0);
  const normalGap = median(gaps);

  let out = clean[0].text;
  for (let i = 1; i < clean.length; i++) {
    const gap = clean[i - 1].y - clean[i].y;
    const newParagraph = gap <= 0 || (normalGap > 0 && gap > normalGap * 1.5);
    const text = clean[i].text;

    if (newParagraph) out += '\n\n' + text;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(text)) out = out.slice(0, -1) + text; // un-hyphenate
    else out += ' ' + text;
  }
  return out;
}

export async function extractPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const pdf = await openPdf(file);
  const total = pdf.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(pageToText(content.items as unknown[]));
    page.cleanup();
    onProgress?.(i, total);
  }
  await pdf.destroy();

  const charCount = pages.join('').replace(/\s/g, '').length;
  if (charCount < Math.max(40, total * 20)) {
    throw new ExtractionError(
      'This PDF looks like scanned images, so there is no text to read. Try a PDF with selectable text, or paste the text instead.',
    );
  }
  return pages;
}
