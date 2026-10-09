// frontend/src/db/db.ts
// Opens the TatakSuri IndexedDB database and defines stores + indexes.
// Requires: npm install idb

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Reading,
  Session,
  Quiz,
  QuizResult,
  Reviewer,
  Flashcard,
} from './types';

export interface TatakSuriDB extends DBSchema {
  readings: {
    key: string;
    value: Reading;
    indexes: { 'by-createdAt': number };
  };
  sessions: {
    key: string;
    value: Session;
    indexes: { 'by-readingId': string; 'by-createdAt': number };
  };
  quizzes: {
    key: string;
    value: Quiz;
    indexes: { 'by-readingId': string };
  };
  quizResults: {
    key: string;
    value: QuizResult;
    indexes: {
      'by-readingId': string;
      'by-quizId': string;
      'by-createdAt': number;
    };
  };
  reviewers: {
    key: string;
    value: Reviewer;
    indexes: { 'by-readingId': string };
  };
  flashcards: {
    key: string;
    value: Flashcard;
    indexes: { 'by-readingId': string; 'by-box': number };
  };
}

export const DB_NAME = 'tataksuri';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TatakSuriDB>> | null = null;

/** Singleton: every caller shares one open connection. */
export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<TatakSuriDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Add new `if (oldVersion < N)` blocks for future schema changes.
        // Never edit the version 1 block once real data exists.
        if (oldVersion < 1) {
          const readings = db.createObjectStore('readings', { keyPath: 'id' });
          readings.createIndex('by-createdAt', 'createdAt');

          const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('by-readingId', 'readingId');
          sessions.createIndex('by-createdAt', 'createdAt');

          const quizzes = db.createObjectStore('quizzes', { keyPath: 'id' });
          quizzes.createIndex('by-readingId', 'readingId');

          const results = db.createObjectStore('quizResults', { keyPath: 'id' });
          results.createIndex('by-readingId', 'readingId');
          results.createIndex('by-quizId', 'quizId');
          results.createIndex('by-createdAt', 'createdAt');

          const reviewers = db.createObjectStore('reviewers', { keyPath: 'id' });
          reviewers.createIndex('by-readingId', 'readingId');

          const cards = db.createObjectStore('flashcards', { keyPath: 'id' });
          cards.createIndex('by-readingId', 'readingId');
          cards.createIndex('by-box', 'box');
        }
      },
      blocked() {
        console.warn('TatakSuri DB upgrade blocked: close other tabs of this app.');
      },
      terminated() {
        dbPromise = null; // reopen on next call if the browser kills the connection
      },
    });
  }
  return dbPromise;
}

/**
 * Ask the browser not to evict our data under storage pressure.
 * Call once on app start. Safe to ignore if it returns false.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  }
  return false;
}