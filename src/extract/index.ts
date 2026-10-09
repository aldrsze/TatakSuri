// frontend/src/extract/index.ts
// Single entry point: give it a File (or pasted text), get clean text back.
// Heavy libraries (pdf.js, mammoth, jszip) are loaded only when that file type is used.

import type { SourceType } from '../db/types';
import { cleanText, ExtractionError } from './utils';

export { ExtractionError };

/** Use as <input type="file" accept={ACCEPTED_FILE_TYPES} /> */
export const ACCEPTED_FILE_TYPES = '.pdf,.txt,.md,.docx,.pptx';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const LONG_READING_CHARS = 40_000; // about 6,500 words

export interface ExtractedDocument {
  title: string;
  text: string; // clean full text; paragraphs separated by blank lines
  pages: string[]; // per page (PDF) / slide (PPTX); a single entry for other types
  sourceType: SourceType;
  fileName?: string;
  warnings: string[]; // show these to the student, they are not errors
}

function buildDocument(
  pages: string[],
  meta: { title: string; sourceType: SourceType; fileName?: string },
): ExtractedDocument {
  const cleaned = pages.map(cleanText).filter(Boolean);
  const text = cleaned.join('\n\n');

  if (text.replace(/\s/g, '').length < 20) {
    throw new ExtractionError('There is not enough readable text in this file.');
  }

  const warnings: string[] = [];
  if (text.length > LONG_READING_CHARS) {
    const words = Math.round(text.length / 6).toLocaleString();
    warnings.push(
      `This is a long reading (about ${words} words). Generating on a laptop can be slow, so consider uploading just one chapter or section.`,
    );
  }

  return { ...meta, text, pages: cleaned };
}

export async function extractFromFile(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedDocument> {
  if (file.size === 0) throw new ExtractionError('This file is empty.');
  if (file.size > MAX_FILE_BYTES) {
    throw new ExtractionError('This file is too large (limit is 25 MB). Try uploading a single chapter.');
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const meta = { title: file.name.replace(/\.[^.]+$/, ''), fileName: file.name };

  switch (ext) {
    case 'pdf': {
      const { extractPdf } = await import('./pdf');
      return buildDocument(await extractPdf(file, onProgress), { ...meta, sourceType: 'pdf' });
    }
    case 'docx': {
      const { extractDocx } = await import('./docx');
      return buildDocument([await extractDocx(file)], { ...meta, sourceType: 'docx' });
    }
    case 'pptx': {
      const { extractPptx } = await import('./pptx');
      return buildDocument(await extractPptx(file), { ...meta, sourceType: 'pptx' });
    }
    case 'txt':
    case 'md':
      return buildDocument([await file.text()], { ...meta, sourceType: 'txt' });
    case 'doc':
      throw new ExtractionError(
        'Older .doc files are not supported. In Word, choose File > Save As > .docx and upload that.',
      );
    case 'ppt':
      throw new ExtractionError(
        'Older .ppt files are not supported. In PowerPoint, choose File > Save As > .pptx and upload that.',
      );
    default:
      throw new ExtractionError('Unsupported file type. Please upload a PDF, DOCX, PPTX, or TXT file.');
  }
}

export function extractFromPaste(text: string, title?: string): ExtractedDocument {
  const firstLine = text.trim().split('\n')[0]?.slice(0, 60).trim();
  return buildDocument([text], {
    title: title?.trim() || firstLine || 'Pasted reading',
    sourceType: 'paste',
  });
}
