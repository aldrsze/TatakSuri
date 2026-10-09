// frontend/src/components/ArgumentCheck.tsx
// Argument Checker: assumptions, missing perspectives, weak arguments / fallacies.

import { useRef, useState } from 'react';
import { checkArguments, type ArgumentCheckResult } from '../ai/argumentChecker';
import { logSession } from '../db/repositories';
import type { Reading } from '../db/types';
import { NeedsModel, errorMessage, isAbort } from './common';

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p>Nothing found.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ArgumentCheck({ reading }: { reading: Reading }) {
  const [result, setResult] = useState<ArgumentCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  async function run() {
    setError('');
    setResult(null);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const r = await checkArguments({
        text: reading.text,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress(`Part ${done} of ${total} done`),
      });
      setResult(r);
      await logSession(reading.id, 'argument-check');
    } catch (e) {
      if (!isAbort(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <section>
      <h2>Argument Checker</h2>
      <p>Finds hidden assumptions, missing viewpoints, and weak reasoning in the reading.</p>

      <NeedsModel>
        <button onClick={run} disabled={busy}>
          Check this reading
        </button>{' '}
        {busy && <button onClick={() => abort.current?.abort()}>Stop</button>}
        {busy && <p>Analyzing… {progress}</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}

        {result && (
          <div>
            <h3>Main claim</h3>
            <p>{result.mainClaim || 'Not identified.'}</p>

            <List title="Assumptions" items={result.assumptions} />
            <List title="Missing perspectives" items={result.missingPerspectives} />

            <h3>Weak arguments</h3>
            {result.weakArguments.length === 0 ? (
              <p>Nothing found.</p>
            ) : (
              <ul>
                {result.weakArguments.map((w) => (
                  <li key={w.problem}>
                    {w.passage && <blockquote style={{ margin: 0 }}>“{w.passage}”</blockquote>}
                    {w.problem}
                    {w.fallacy && <> (fallacy: {w.fallacy})</>}
                  </li>
                ))}
              </ul>
            )}
            <p>
              <i>The AI can make mistakes. Check these against the reading.</i>
            </p>
          </div>
        )}
      </NeedsModel>
    </section>
  );
}
