// frontend/src/extract/docx.ts
// Word (.docx) text extraction with mammoth.
// Requires: npm install mammoth

import * as mammoth from 'mammoth';
import { ExtractionError } from './utils';

export async function extractDocx(file: File): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value; // paragraphs are separated by blank lines
  } catch {
    throw new ExtractionError(
      'This Word file could not be read. Make sure it is a .docx file (older .doc files are not supported).',
    );
  }
}
