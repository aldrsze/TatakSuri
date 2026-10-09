// frontend/src/db/repositories.ts
// Small, typed functions the UI calls. Components never touch IndexedDB directly.

import { getDb } from './db';
import {
  MAX_BOX,
  type ChatMessage,
  type DashboardStats,
  type Difficulty,
  type Flashcard,
  type Quiz,
  type QuizQuestion,
  type QuizResult,
  type Reading,
  type Reviewer,
  type ReviewerLength,
  type Session,
  type SessionType,
  type SourceType,
} from './types';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

/* ------------------------------ Readings ------------------------------ */

export async function addReading(input: {
  title: string;
  text: string;
  sourceType: SourceType;
  fileName?: string;
}): Promise<Reading> {
  const reading: Reading = { id: newId(), createdAt: now(), ...input };
  await (await getDb()).add('readings', reading);
  return reading;
}

export async function getReading(id: string) {
  return (await getDb()).get('readings', id);
}

/** Newest first. */
export async function listReadings(): Promise<Reading[]> {
  const all = await (await getDb()).getAllFromIndex('readings', 'by-createdAt');
  return all.reverse();
}

/** Deletes a reading and everything generated from it, in one transaction. */
export async function deleteReading(readingId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ['readings', 'sessions', 'quizzes', 'quizResults', 'reviewers', 'flashcards'],
    'readwrite',
  );

  for (const k of await tx.objectStore('sessions').index('by-readingId').getAllKeys(readingId))
    await tx.objectStore('sessions').delete(k);
  for (const k of await tx.objectStore('quizzes').index('by-readingId').getAllKeys(readingId))
    await tx.objectStore('quizzes').delete(k);
  for (const k of await tx.objectStore('quizResults').index('by-readingId').getAllKeys(readingId))
    await tx.objectStore('quizResults').delete(k);
  for (const k of await tx.objectStore('reviewers').index('by-readingId').getAllKeys(readingId))
    await tx.objectStore('reviewers').delete(k);
  for (const k of await tx.objectStore('flashcards').index('by-readingId').getAllKeys(readingId))
    await tx.objectStore('flashcards').delete(k);

  await tx.objectStore('readings').delete(readingId);
  await tx.done;
}

/* ------------------------------ Sessions ------------------------------ */

export async function logSession(
  readingId: string,
  type: SessionType,
  messages?: ChatMessage[],
): Promise<Session> {
  const session: Session = { id: newId(), readingId, type, messages, createdAt: now() };
  await (await getDb()).add('sessions', session);
  return session;
}

/** Use this to save a Reading Buddy chat as it grows. */
export async function updateSessionMessages(sessionId: string, messages: ChatMessage[]) {
  const db = await getDb();
  const session = await db.get('sessions', sessionId);
  if (session) await db.put('sessions', { ...session, messages });
}

export async function listSessionsByReading(readingId: string) {
  return (await getDb()).getAllFromIndex('sessions', 'by-readingId', readingId);
}

/* ------------------------------- Quizzes ------------------------------ */

export async function saveQuiz(
  readingId: string,
  difficulty: Difficulty,
  questions: Omit<QuizQuestion, 'id'>[],
): Promise<Quiz> {
  const quiz: Quiz = {
    id: newId(),
    readingId,
    difficulty,
    questions: questions.map((q) => ({ ...q, id: newId() })),
    createdAt: now(),
  };
  await (await getDb()).add('quizzes', quiz);
  return quiz;
}

export async function getQuiz(id: string) {
  return (await getDb()).get('quizzes', id);
}

export async function listQuizzesByReading(readingId: string) {
  return (await getDb()).getAllFromIndex('quizzes', 'by-readingId', readingId);
}

export async function saveQuizResult(
  quiz: Pick<Quiz, 'id' | 'readingId'>,
  score: number,
  total: number,
): Promise<QuizResult> {
  const result: QuizResult = {
    id: newId(),
    quizId: quiz.id,
    readingId: quiz.readingId,
    score,
    total,
    createdAt: now(),
  };
  await (await getDb()).add('quizResults', result);
  return result;
}

/* ------------------------------ Reviewers ----------------------------- */

export async function saveReviewer(
  readingId: string,
  length: ReviewerLength,
  content: string,
): Promise<Reviewer> {
  const reviewer: Reviewer = { id: newId(), readingId, length, content, createdAt: now() };
  await (await getDb()).add('reviewers', reviewer);
  return reviewer;
}

export async function getReviewer(id: string) {
  return (await getDb()).get('reviewers', id);
}

export async function listReviewersByReading(readingId: string) {
  return (await getDb()).getAllFromIndex('reviewers', 'by-readingId', readingId);
}

/* ------------------------------ Flashcards ---------------------------- */

export async function saveFlashcards(
  readingId: string,
  cards: { front: string; back: string }[],
): Promise<Flashcard[]> {
  const db = await getDb();
  const created = cards.map<Flashcard>((c) => ({
    id: newId(),
    readingId,
    front: c.front,
    back: c.back,
    box: 1,
    lastReviewed: null,
    timesCorrect: 0,
    createdAt: now(),
  }));
  const tx = db.transaction('flashcards', 'readwrite');
  await Promise.all([...created.map((c) => tx.store.add(c)), tx.done]);
  return created;
}

export async function listFlashcardsByReading(readingId: string) {
  return (await getDb()).getAllFromIndex('flashcards', 'by-readingId', readingId);
}

/**
 * Study order: lowest box first (missed cards come back sooner), then the
 * least recently reviewed. Cards never reviewed sort first within a box.
 */
export async function getStudyQueue(readingId: string): Promise<Flashcard[]> {
  const cards = await listFlashcardsByReading(readingId);
  return cards.sort(
    (a, b) => a.box - b.box || (a.lastReviewed ?? 0) - (b.lastReviewed ?? 0),
  );
}

/** Simple Leitner step: "Got it" moves up a box, "Review again" drops to box 1. */
export async function reviewFlashcard(cardId: string, gotIt: boolean) {
  const db = await getDb();
  const card = await db.get('flashcards', cardId);
  if (!card) return;
  await db.put('flashcards', {
    ...card,
    box: gotIt ? Math.min(card.box + 1, MAX_BOX) : 1,
    timesCorrect: card.timesCorrect + (gotIt ? 1 : 0),
    lastReviewed: now(),
  });
}

/* ------------------------------ Dashboard ----------------------------- */

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = await getDb();
  const [readingCount, sessionCount, results, cards] = await Promise.all([
    db.count('readings'),
    db.count('sessions'),
    db.getAllFromIndex('quizResults', 'by-createdAt'),
    db.getAll('flashcards'),
  ]);

  const quizScoreHistory = results.map((r) => ({
    date: r.createdAt,
    percent: r.total ? Math.round((r.score / r.total) * 100) : 0,
  }));
  const averageQuizPercent = quizScoreHistory.length
    ? Math.round(
        quizScoreHistory.reduce((sum, r) => sum + r.percent, 0) / quizScoreHistory.length,
      )
    : 0;

  return {
    readingCount,
    sessionCount,
    quizAttempts: results.length,
    averageQuizPercent,
    quizScoreHistory,
    flashcardsTotal: cards.length,
    flashcardsMastered: cards.filter((c) => c.box >= MAX_BOX).length,
  };
}