// frontend/src/components/FlashcardsTab.tsx
// Flashcards: generate, then flip cards and mark "Got it" / "Review again".
// Missed cards come back a few cards later in the same session (Leitner boxes in the DB).

import { useEffect, useRef, useState } from 'react';
import { generateFlashcards } from '../ai/generators';
import {
  getStudyQueue,
  listFlashcardsByReading,
  reviewFlashcard,
  saveFlashcards,
} from '../db/repositories';
import { MAX_BOX, type Flashcard, type Reading } from '../db/types';
import { NeedsModel, errorMessage, isAbort } from './common';

export default function FlashcardsTab({ reading }: { reading: Reading }) {
  const [count, setCount] = useState(10);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);

  const [studying, setStudying] = useState(false);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  async function loadCards() {
    setCards(await listFlashcardsByReading(reading.id));
  }

  useEffect(() => {
    loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setError('');
    setMessage('');
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const made = await generateFlashcards({
        text: reading.text,
        count,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress(`Step ${done} of ${total} done`),
      });
      await saveFlashcards(reading.id, made);
      setMessage(`Added ${made.length} flashcards.`);
      await loadCards();
    } catch (e) {
      if (!isAbort(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function startStudy() {
    const q = await getStudyQueue(reading.id);
    if (!q.length) return;
    setQueue(q);
    setIndex(0);
    setFlipped(false);
    setMessage('');
    setStudying(true);
  }

  async function mark(gotIt: boolean) {
    const card = queue[index];
    await reviewFlashcard(card.id, gotIt);

    let nextQueue = queue;
    if (!gotIt) {
      // show the missed card again a few cards later
      nextQueue = [...queue];
      nextQueue.splice(Math.min(index + 4, queue.length), 0, card);
    }

    setFlipped(false);
    if (index + 1 >= nextQueue.length) {
      setStudying(false);
      setMessage('Study session finished.');
      await loadCards();
    } else {
      setQueue(nextQueue);
      setIndex(index + 1);
    }
  }

  if (studying) {
    const card = queue[index];
    return (
      <section>
        <h2>Flashcards</h2>
        <p>
          Card {index + 1} of {queue.length} (box {card.box} of {MAX_BOX})
        </p>
        <div style={{ border: '1px solid #888', padding: 16, minHeight: 80 }}>
          <p>
            <b>{card.front}</b>
          </p>
          {flipped && <p>{card.back}</p>}
        </div>
        <p>
          {!flipped ? (
            <button onClick={() => setFlipped(true)}>Flip</button>
          ) : (
            <>
              <button onClick={() => mark(true)}>Got it</button>{' '}
              <button onClick={() => mark(false)}>Review again</button>
            </>
          )}{' '}
          <button
            onClick={() => {
              setStudying(false);
              loadCards();
            }}
          >
            End session
          </button>
        </p>
      </section>
    );
  }

  const inBox = (n: number) => cards.filter((c) => c.box === n).length;

  return (
    <section>
      <h2>Flashcards</h2>

      <NeedsModel>
        <p>
          Number of cards:{' '}
          <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />{' '}
          <button onClick={generate} disabled={busy}>
            Generate flashcards
          </button>{' '}
          {busy && <button onClick={() => abort.current?.abort()}>Stop</button>}
        </p>
        {busy && <p>Generating… {progress}</p>}
      </NeedsModel>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {message && <p>{message}</p>}

      <h3>Your cards for this reading</h3>
      <p>
        {cards.length} cards total.{' '}
        {Array.from({ length: MAX_BOX }, (_, i) => i + 1)
          .map((n) => `Box ${n}${n === MAX_BOX ? ' (mastered)' : ''}: ${inBox(n)}`)
          .join(' | ')}
      </p>
      <button onClick={startStudy} disabled={cards.length === 0}>
        Study now
      </button>
      <p>
        <i>Cards you miss come back more often. You can study without the AI model loaded.</i>
      </p>
    </section>
  );
}
