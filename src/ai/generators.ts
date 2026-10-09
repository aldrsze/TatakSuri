// frontend/src/ai/generators.ts
// Quiz Maker, Flashcards, Reviewer Maker, and the explain-why grader.
// Each function returns plain data that plugs straight into the db repositories:
//   const questions = await generateQuiz({ text: reading.text, count: 5 });
//   const quiz = await saveQuiz(reading.id, 'medium', questions);

import { complete, type ChatCompletionMessageParam } from './engine';
import { AiOutputError, generateJson, validateFlashcards, validateQuestions } from './jsonOutput';
import { normalizeKey, planTasks, runBatches, selectChunks, shuffle } from './chunks';
import {
  FLASHCARDS_SYSTEM,
  GRADER_SYSTEM,
  REVIEWER_COUNTS,
  flashcardsUser,
  graderUser,
  quizSystem,
  quizUser,
  reviewerSystem,
  reviewerUser,
} from './prompts';
import type { Difficulty, QuestionType, QuizQuestion, ReviewerLength } from '../db/types';

interface CommonOptions {
  text: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/* ---------------------------------- Quiz ---------------------------------- */

export const ALL_QUESTION_TYPES: QuestionType[] = [
  'multiple-choice',
  'true-false',
  'identification',
  'explain-why',
];

/**
 * May return fewer questions than requested if the model produced duplicates or
 * invalid items. Check `.length` and tell the student if it is short.
 */
export async function generateQuiz(
  opts: CommonOptions & { count?: number; difficulty?: Difficulty; types?: QuestionType[] },
): Promise<Omit<QuizQuestion, 'id'>[]> {
  const count = clamp(opts.count ?? 5, 1, 20);
  const difficulty = opts.difficulty ?? 'medium';
  const types = opts.types?.length ? opts.types : ALL_QUESTION_TYPES;

  const tasks = planTasks(opts.text, count, { maxChunks: 4, maxPerCall: 5 });
  const batches = await runBatches(
    tasks,
    ({ chunk, n }) =>
      generateJson({
        system: quizSystem(types, difficulty),
        user: quizUser(n, chunk),
        validate: validateQuestions,
        maxTokens: Math.min(1800, 250 + n * 220),
        signal: opts.signal,
      }),
    { onProgress: opts.onProgress, signal: opts.signal },
  );

  const all = batches.flat();
  const allowed = all.filter((q) => types.includes(q.type));
  const pool = allowed.length ? allowed : all; // if the model ignored the types, keep what we have

  const seen = new Set<string>();
  const out: Omit<QuizQuestion, 'id'>[] = [];
  for (const q of pool) {
    const key = normalizeKey(q.question);
    if (seen.has(key)) continue;
    seen.add(key);
    // Models like to put the right answer in the same spot, so shuffle the choices
    out.push(q.choices ? { ...q, choices: shuffle(q.choices) } : q);
  }
  return out.slice(0, count);
}

/* ------------------------- Grading "explain why" -------------------------- */

export interface ExplainGrade {
  verdict: 'good' | 'partial' | 'off';
  feedback: string;
  points: number; // 1, 0.5, or 0, for the quiz score
}

export async function gradeExplanation(opts: {
  question: string;
  modelAnswer: string;
  studentAnswer: string;
  signal?: AbortSignal;
}): Promise<ExplainGrade> {
  if (!opts.studentAnswer.trim()) {
    return { verdict: 'off', feedback: 'You did not write an answer. Try explaining it in your own words.', points: 0 };
  }

  const verdict = await generateJson({
    system: GRADER_SYSTEM,
    user: graderUser(opts.question, opts.modelAnswer, opts.studentAnswer),
    validate: (data) => {
      const d = data as any;
      const v = String(d?.verdict ?? '').toLowerCase().trim();
      if (v !== 'good' && v !== 'partial' && v !== 'off') throw new Error('verdict must be good, partial, or off.');
      return { verdict: v as ExplainGrade['verdict'], feedback: String(d?.feedback ?? '').trim() };
    },
    maxTokens: 250,
    signal: opts.signal,
  });

  const points = verdict.verdict === 'good' ? 1 : verdict.verdict === 'partial' ? 0.5 : 0;
  return { ...verdict, points };
}

/* -------------------------------- Flashcards ------------------------------- */

export async function generateFlashcards(
  opts: CommonOptions & { count?: number },
): Promise<{ front: string; back: string }[]> {
  const count = clamp(opts.count ?? 10, 1, 30);
  const tasks = planTasks(opts.text, count, { maxChunks: 4, maxPerCall: 8 });

  const batches = await runBatches(
    tasks,
    ({ chunk, n }) =>
      generateJson({
        system: FLASHCARDS_SYSTEM,
        user: flashcardsUser(n, chunk),
        validate: validateFlashcards,
        maxTokens: Math.min(1500, 200 + n * 90),
        signal: opts.signal,
      }),
    { onProgress: opts.onProgress, signal: opts.signal },
  );

  const seen = new Set<string>();
  return batches
    .flat()
    .filter((c) => {
      const key = normalizeKey(c.front);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);
}

/* --------------------------------- Reviewer -------------------------------- */

const SECTIONS = [
  { key: 'mainIdea', heading: 'Main Idea', match: /main idea/i },
  { key: 'keyPoints', heading: 'Key Points', match: /key point/i },
  { key: 'terms', heading: 'Important Terms', match: /term/i },
  { key: 'arguments', heading: 'Main Arguments', match: /argument/i },
  { key: 'think', heading: 'Think About It', match: /think/i },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];
type ParsedReviewer = Partial<Record<SectionKey, string[]>>;

const stripBullet = (line: string) => line.replace(/^([-*•]|\d+[.)])\s+/, '').trim();

/** Splits the model's Markdown into its five sections and checks the format. */
function parseReviewer(raw: string): ParsedReviewer {
  const parsed: ParsedReviewer = {};
  let current: SectionKey | null = null;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,4}\s*(.+?)\s*:?$/);
    if (heading) {
      const section = SECTIONS.find((s) => s.match.test(heading[1]));
      if (section) {
        current = section.key;
        parsed[current] ??= [];
        continue;
      }
    }
    if (current && line) parsed[current]!.push(line);
  }

  const filled = SECTIONS.filter((s) => parsed[s.key]?.length).length;
  if (!parsed.mainIdea?.length || !parsed.keyPoints?.length || filled < 3) {
    throw new Error('missing required sections (need Main Idea, Key Points, and at least one more)');
  }
  return parsed;
}

async function reviewerForChunk(
  chunk: string,
  length: ReviewerLength,
  signal?: AbortSignal,
): Promise<ParsedReviewer> {
  const base: ChatCompletionMessageParam[] = [
    { role: 'system', content: reviewerSystem(length) },
    { role: 'user', content: reviewerUser(chunk) },
  ];
  let raw = '';
  let error = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: ChatCompletionMessageParam[] =
      attempt === 0
        ? base
        : [
            ...base,
            ...(raw ? [{ role: 'assistant' as const, content: raw }] : []),
            {
              role: 'user' as const,
              content: `That reply did not follow the format: ${error}. Write it again using exactly these headings: ## Main Idea, ## Key Points, ## Important Terms, ## Main Arguments, ## Think About It.`,
            },
          ];
    try {
      raw = await complete({ messages, temperature: 0.3, maxTokens: REVIEWER_COUNTS[length].maxTokens, signal });
      return parseReviewer(raw);
    } catch (e) {
      if (signal?.aborted) throw e;
      error = e instanceof Error ? e.message : String(e);
    }
  }
  throw new AiOutputError(
    'The AI could not produce a usable reviewer. Try again, use a shorter reading, or switch to a different model.',
  );
}

/** Returns Markdown, ready for saveReviewer() and for copy / download as .md. */
export async function generateReviewer(
  opts: CommonOptions & { length?: ReviewerLength; title?: string },
): Promise<string> {
  const length = opts.length ?? 'short';
  const chunks = selectChunks(opts.text, 4);

  const parts = await runBatches(chunks, (chunk) => reviewerForChunk(chunk, length, opts.signal), {
    onProgress: opts.onProgress,
    signal: opts.signal,
  });

  const blocks: string[] = [];
  if (opts.title) blocks.push(`# Reviewer: ${opts.title}`);

  for (const section of SECTIONS) {
    const lines = parts.flatMap((p) => p[section.key] ?? []);
    if (!lines.length) continue;

    let body: string;
    if (section.key === 'mainIdea') {
      body = lines.map(stripBullet).join(' '); // one paragraph, joined across parts
    } else {
      const seen = new Set<string>();
      body = lines
        .map((l) => `- ${stripBullet(l)}`)
        .filter((l) => {
          const key = normalizeKey(l);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .join('\n');
    }
    blocks.push(`## ${section.heading}\n${body}`);
  }
  return blocks.join('\n\n') + '\n';
}
