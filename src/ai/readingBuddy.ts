// frontend/src/ai/readingBuddy.ts
// Socratic chat. The model only sees ONE passage of the reading at a time (the one
// most relevant to what the student just said), so long readings still fit in a
// small model's context window.

import { streamChat, type ChatCompletionMessageParam } from './engine';
import { splitIntoChunks } from './jsonOutput';
import { READING_BUDDY_OPENING, readingBuddySystem } from './prompts';
import { GENERATION_CHUNK_CHARS } from './chunks';
import type { ChatMessage } from '../db/types';

const MAX_HISTORY_MESSAGES = 8; // last 4 exchanges
const FALLBACK_QUESTION = ' What part of the reading makes you think that?';

/** Picks the chunk that shares the most words with the student's recent messages. */
export function pickPassage(text: string, query: string): string {
  const chunks = splitIntoChunks(text, GENERATION_CHUNK_CHARS);
  if (chunks.length <= 1) return chunks[0] ?? text;

  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])];
  if (!words.length) return chunks[0];

  let best = 0;
  let bestScore = -1;
  chunks.forEach((chunk, i) => {
    const lower = chunk.toLowerCase();
    const score = words.reduce((sum, w) => sum + (lower.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return chunks[best];
}

/**
 * Get Reading Buddy's next reply.
 *  - First message: leave `userMessage` empty and pass an empty `history`.
 *  - After that: pass the student's new message as `userMessage` and the earlier
 *    messages as `history`. Then YOU save both the student message and the reply
 *    (for example with updateSessionMessages).
 */
export async function askBuddy(opts: {
  readingText: string;
  history: ChatMessage[];
  userMessage?: string;
  onToken?: (token: string, full: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const query = [opts.userMessage ?? '', ...opts.history.slice(-2).map((m) => m.content)].join(' ');
  const passage = pickPassage(opts.readingText, query);

  const recent: ChatCompletionMessageParam[] = opts.history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam);

  // The chat should start with a user turn, so re-add the hidden opening request
  // if the window begins with Reading Buddy's first question.
  if (recent[0]?.role === 'assistant') {
    recent.unshift({ role: 'user', content: READING_BUDDY_OPENING });
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: readingBuddySystem(passage) },
    ...recent,
    { role: 'user', content: opts.userMessage ?? READING_BUDDY_OPENING },
  ];

  let reply = (
    await streamChat({
      messages,
      temperature: 0.7,
      maxTokens: 200,
      onToken: opts.onToken,
      signal: opts.signal,
    })
  ).trim();

  // Socratic guard: a reply with no question is a lecture. Add one.
  if (!reply.includes('?')) {
    reply += FALLBACK_QUESTION;
    opts.onToken?.(FALLBACK_QUESTION, reply);
  }
  return reply;
}
