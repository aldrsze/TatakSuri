// frontend/src/App.tsx
// Basic shell: model loader, reading picker, and one tab per feature. No styling yet.

import { useEffect, useState } from 'react';
import { requestPersistentStorage } from './db/db';
import type { Reading } from './db/types';
import ArgumentCheck from './components/ArgumentCheck';
import Buddy from './components/Buddy';
import Dashboard from './components/Dashboard';
import FlashcardsTab from './components/FlashcardsTab';
import ModelLoader from './components/ModelLoader';
import QuizTab from './components/QuizTab';
import ReadingInput from './components/ReadingInput';
import ReviewerTab from './components/ReviewerTab';

const TABS = [
  ['buddy', 'Reading Buddy'],
  ['argument', 'Argument Checker'],
  ['quiz', 'Quiz Maker'],
  ['reviewer', 'Reviewer Maker'],
  ['flashcards', 'Flashcards'],
  ['dashboard', 'Progress Dashboard'],
] as const;

type Tab = (typeof TABS)[number][0];

export default function App() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [tab, setTab] = useState<Tab>('buddy');

  useEffect(() => {
    requestPersistentStorage();
  }, []);

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: 16, fontFamily: 'sans-serif', textAlign: 'left' }}>
      <h1>TatakSuri</h1>

      <ModelLoader />
      <hr />
      <ReadingInput selectedId={reading?.id ?? null} onSelect={setReading} />
      <hr />

      <p>
        Current reading: <b>{reading ? reading.title : 'none selected'}</b>
      </p>

      <nav>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} disabled={tab === id} style={{ marginRight: 4 }}>
            {label}
          </button>
        ))}
      </nav>

      {/* key={reading.id} resets each panel when you switch readings */}
      {tab === 'dashboard' ? (
        <Dashboard />
      ) : !reading ? (
        <p>Select or add a reading first.</p>
      ) : (
        <>
          {tab === 'buddy' && <Buddy key={reading.id} reading={reading} />}
          {tab === 'argument' && <ArgumentCheck key={reading.id} reading={reading} />}
          {tab === 'quiz' && <QuizTab key={reading.id} reading={reading} />}
          {tab === 'reviewer' && <ReviewerTab key={reading.id} reading={reading} />}
          {tab === 'flashcards' && <FlashcardsTab key={reading.id} reading={reading} />}
        </>
      )}
    </main>
  );
}
