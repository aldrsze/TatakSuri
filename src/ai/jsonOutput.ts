// frontend/src/ai/jsonOutput.ts
// Small local models produce messy JSON. This file handles the TRD's
// "ask for JSON, validate, retry once, then show a friendly error" rule,
// plus validators that clean model output into the DB types, and text chunking.

import { complete, type ChatCompletionMessageParam } from './engine';
import type { QuestionType, QuizQuestion } from '../db/types';

export class AiOutputError extends Error {}

/* ------------------------------ JSON parsing ------------------------------ */

/** Pulls the first JSON object/array out of text, tolerating ```json fences and chatter. */
export function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('No JSON found in the model output.');

  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end <= start) throw new Error('The JSON looks cut off (output may have hit the length limit).');

  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Asks the model for JSON, validates it, and retries once (with the error
 * fed back, and without strict JSON mode) before giving up.
 */
export async function generateJson<T>(opts: {
  system: string;
  user: string;
  validate: (data: unknown) => T; // throw an Error if the data is unusable
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const base: ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];

  let lastError = '';
  let lastRaw = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: ChatCompletionMessageParam[] =
      attempt === 0
        ? base
        : [
            ...base,
            ...(lastRaw ? [{ role: 'assistant' as const, content: lastRaw }] : []),
            {
              role: 'user' as const,
              content: `That output was not usable: ${lastError}. Reply again with ONLY valid JSON in the requested format and no other text.`,
            },
          ];

    try {
      lastRaw = await complete({
        messages,
        json: attempt === 0,
        maxTokens: opts.maxTokens ?? 1500,
        temperature: opts.temperature ?? 0.3,
        signal: opts.signal,
      });
      return opts.validate(extractJson(lastRaw));
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new AiOutputError(
    'The AI could not produce a usable result. Try again, use a shorter reading, or switch to a different model.',
  );
}

/* ------------------------------- Validators ------------------------------- */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const TYPE_ALIASES: Record<string, QuestionType> = {
  'multiple-choice': 'multiple-choice',
  mcq: 'multiple-choice',
  'true-false': 'true-false',
  truefalse: 'true-false',
  'true/false': 'true-false',
  identification: 'identification',
  'explain-why': 'explain-why',
  explain: 'explain-why',
  'short-answer': 'explain-why',
};

const stripLetter = (s: string) => s.replace(/^[A-Da-d][).:]\s+/, '').trim();

function normalizeQuestion(item: any): Omit<QuizQuestion, 'id'> | null {
  if (!item || typeof item !== 'object') return null;

  const type = TYPE_ALIASES[str(item.type).toLowerCase().replace(/[_\s]+/g, '-')];
  const question = str(item.question);
  const correctRaw = str(item.correctAnswer ?? item.answer);
  const explanation = str(item.explanation);
  if (!type || !question || !correctRaw) return null;

  if (type === 'multiple-choice') {
    const choices = Array.isArray(item.choices)
      ? item.choices.map((c: unknown) => stripLetter(str(c))).filter(Boolean)
      : [];
    if (choices.length < 2) return null;

    // The model may answer with a letter ("B", "B)") or with the choice text.
    const letter = correctRaw.match(/^([A-Da-d])(?:[).:]|$)/);
    let correctAnswer: string | undefined;
    if (letter) correctAnswer = choices[letter[1].toUpperCase().charCodeAt(0) - 65];
    if (!correctAnswer) {
      const wanted = stripLetter(correctRaw).toLowerCase();
      correctAnswer = choices.find((c: string) => c.toLowerCase() === wanted);
    }
    if (!correctAnswer) return null;

    return { type, question, choices, correctAnswer, explanation };
  }

  if (type === 'true-false') {
    const correctAnswer = /^t/i.test(correctRaw) ? 'True' : /^f/i.test(correctRaw) ? 'False' : '';
    if (!correctAnswer) return null;
    return { type, question, correctAnswer, explanation };
  }

  // identification and explain-why (correctAnswer is the model answer for explain-why)
  return { type, question, correctAnswer: correctRaw, explanation };
}

/** Accepts {"questions": [...]} or a bare array. Drops bad items; throws if none survive. */
export function validateQuestions(data: unknown): Omit<QuizQuestion, 'id'>[] {
  const list = Array.isArray(data) ? data : (data as any)?.questions;
  if (!Array.isArray(list)) throw new Error('Expected {"questions": [...]}.');

  const out = list.map(normalizeQuestion).filter((q): q is Omit<QuizQuestion, 'id'> => q !== null);
  if (!out.length) throw new Error('None of the questions were valid or answerable.');
  return out;
}

/** Accepts {"cards": [{front, back}]} or a bare array. Removes empty and duplicate cards. */
export function validateFlashcards(data: unknown): { front: string; back: string }[] {
  const list = Array.isArray(data) ? data : (data as any)?.cards;
  if (!Array.isArray(list)) throw new Error('Expected {"cards": [...]}.');

  const seen = new Set<string>();
  const out: { front: string; back: string }[] = [];
  for (const item of list) {
    const front = str(item?.front);
    const back = str(item?.back);
    const key = front.toLowerCase();
    if (!front || !back || seen.has(key)) continue;
    seen.add(key);
    out.push({ front, back });
  }
  if (!out.length) throw new Error('No valid flashcards found.');
  return out;
}

/* --------------------------------- Chunking -------------------------------- */

/**
 * Splits a long reading into pieces that fit a small model's context window
 * (~4 chars per token; 6000 chars leaves room for the prompt and the answer
 * in a 4096-token window). Splits on paragraphs first.
 */
export function splitIntoChunks(text: string, maxChars = 6000): string[] {
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length > maxChars) {
      flush();
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (current.length + paragraph.length + 2 > maxChars) flush();
    current += (current ? '\n\n' : '') + paragraph;
  }
  flush();

  return chunks;
}
