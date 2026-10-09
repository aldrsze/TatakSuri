// frontend/src/db/types.ts
// Record shapes for every IndexedDB store in TatakSuri (see TRD section 6.5).
// All dates are epoch milliseconds (Date.now()) so they can be indexed and sorted.

export type SourceType = 'pdf' | 'txt' | 'docx' | 'pptx' | 'paste';

export interface Reading {
  id: string;
  title: string;
  text: string; // extracted text
  sourceType: SourceType;
  fileName?: string;
  createdAt: number;
}

export type SessionType = 'buddy' | 'argument-check';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Session {
  id: string;
  readingId: string;
  type: SessionType;
  messages?: ChatMessage[]; // optional, lets a student reopen a Reading Buddy chat
  createdAt: number;
}

export type Difficulty = 'easy' | 'medium' | 'hard';
export type QuestionType =
  | 'multiple-choice'
  | 'true-false'
  | 'identification'
  | 'explain-why';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  question: string;
  choices?: string[]; // multiple-choice only
  correctAnswer: string;
  explanation: string;
}

export interface Quiz {
  id: string;
  readingId: string;
  difficulty: Difficulty;
  questions: QuizQuestion[];
  createdAt: number;
}

export interface QuizResult {
  id: string;
  quizId: string;
  readingId: string; // denormalized so the dashboard and cascade delete stay simple
  score: number;
  total: number;
  createdAt: number;
}

export type ReviewerLength = 'short' | 'detailed';

export interface Reviewer {
  id: string;
  readingId: string;
  length: ReviewerLength;
  content: string; // Markdown
  createdAt: number;
}

// Leitner boxes: 1 = struggling (shown most), MAX_BOX = mastered.
export const MAX_BOX = 3;

export interface Flashcard {
  id: string;
  readingId: string;
  front: string;
  back: string;
  box: number; // 1..MAX_BOX
  lastReviewed: number | null;
  timesCorrect: number;
  createdAt: number;
}

export interface DashboardStats {
  readingCount: number;
  sessionCount: number;
  quizAttempts: number;
  averageQuizPercent: number; // 0..100
  quizScoreHistory: { date: number; percent: number }[];
  flashcardsTotal: number;
  flashcardsMastered: number;
}