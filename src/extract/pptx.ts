// frontend/src/extract/pptx.ts
// PowerPoint (.pptx) text extraction. A .pptx is a zip of XML files, so we read it
// with JSZip and pull the text runs (<a:t>) out of each slide, in presentation
// order, plus speaker notes. Returns one string per slide.
// Requires: npm install jszip

import JSZip from 'jszip';
import { ExtractionError } from './utils';

const parser = new DOMParser();
const parseXml = (xml: string) => parser.parseFromString(xml, 'application/xml');
const fileNumber = (path: string) => Number(path.match(/(\d+)\.xml$/)?.[1] ?? 0);

function paragraphsOf(xml: string): string[] {
  return Array.from(parseXml(xml).getElementsByTagName('a:p'))
    .map((p) =>
      Array.from(p.getElementsByTagName('a:t'))
        .map((t) => t.textContent ?? '')
        .join('')
        .trim(),
    )
    .filter(Boolean);
}

function relationships(xml: string) {
  return Array.from(parseXml(xml).getElementsByTagName('Relationship')).map((r) => ({
    id: r.getAttribute('Id') ?? '',
    type: r.getAttribute('Type') ?? '',
    target: r.getAttribute('Target') ?? '',
  }));
}

/** Slide file names are not always in presentation order, so read the real order. */
async function getSlidePaths(zip: JSZip): Promise<string[]> {
  const fallback = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => fileNumber(a) - fileNumber(b));

  try {
    const presentation = await zip.file('ppt/presentation.xml')?.async('string');
    const rels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    if (!presentation || !rels) return fallback;

    const targets = new Map(relationships(rels).map((r) => [r.id, r.target]));
    const ordered = Array.from(parseXml(presentation).getElementsByTagName('p:sldId'))
      .map((s) => targets.get(s.getAttribute('r:id') ?? ''))
      .filter((t): t is string => !!t)
      .map((t) => {
        const p = t.replace(/^\//, '');
        return p.startsWith('ppt/') ? p : 'ppt/' + p;
      })
      .filter((p) => zip.file(p));

    return ordered.length ? ordered : fallback;
  } catch {
    return fallback;
  }
}

async function getNotes(zip: JSZip, slidePath: string): Promise<string[]> {
  try {
    const name = slidePath.split('/').pop()!;
    const rels = await zip.file(`ppt/slides/_rels/${name}.rels`)?.async('string');
    const notesRel = rels && relationships(rels).find((r) => r.type.endsWith('/notesSlide'));
    if (!notesRel) return [];

    const notesPath = 'ppt/' + notesRel.target.replace(/^(\.\.\/)+/, '');
    const xml = await zip.file(notesPath)?.async('string');
    // Drop lone numbers (the slide-number placeholder in notes pages)
    return xml ? paragraphsOf(xml).filter((p) => !/^\d+$/.test(p)) : [];
  } catch {
    return [];
  }
}

export async function extractPptx(file: File): Promise<string[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new ExtractionError(
      'This PowerPoint file could not be read. Make sure it is a .pptx file (older .ppt files are not supported).',
    );
  }

  const slidePaths = await getSlidePaths(zip);
  if (!slidePaths.length) {
    throw new ExtractionError('No slides were found in this PowerPoint file.');
  }

  const pages: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const xml = await zip.file(slidePaths[i])!.async('string');
    const body = paragraphsOf(xml);
    const notes = await getNotes(zip, slidePaths[i]);
    if (!body.length && !notes.length) continue;

    pages.push(
      [`Slide ${i + 1}`, ...body, ...(notes.length ? [`Speaker notes: ${notes.join(' ')}`] : [])].join('\n'),
    );
  }
  return pages;
}
