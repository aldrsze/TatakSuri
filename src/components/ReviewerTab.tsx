// frontend/src/components/ReviewerTab.tsx
// Reviewer Maker: generate a Markdown study reviewer, then copy or download it.

import { useEffect, useRef, useState } from 'react';
import { generateReviewer } from '../ai/generators';
import { listReviewersByReading, saveReviewer } from '../db/repositories';
import type { Reading, Reviewer, ReviewerLength } from '../db/types';
import { NeedsModel, errorMessage, formatDate, isAbort } from './common';

export default function ReviewerTab({ reading }: { reading: Reading }) {
  const [length, setLength] = useState<ReviewerLength>('short');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState<Reviewer[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  async function refreshSaved() {
    setSaved((await listReviewersByReading(reading.id)).reverse());
  }

  useEffect(() => {
    refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setError('');
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const md = await generateReviewer({
        text: reading.text,
        length,
        title: reading.title,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress(`Part ${done} of ${total} done`),
      });
      await saveReviewer(reading.id, length, md);
      setContent(md);
      await refreshSaved();
    } catch (e) {
      if (!isAbort(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reading.title.replace(/[^\w-]+/g, '_')}-reviewer.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h2>Reviewer Maker</h2>

      <NeedsModel>
        <p>
          Length:{' '}
          <select value={length} onChange={(e) => setLength(e.target.value as ReviewerLength)}>
            <option value="short">short</option>
            <option value="detailed">detailed</option>
          </select>{' '}
          <button onClick={generate} disabled={busy}>
            Generate reviewer
          </button>{' '}
          {busy && <button onClick={() => abort.current?.abort()}>Stop</button>}
        </p>
        {busy && <p>Generating… {progress}</p>}
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </NeedsModel>

      {content && (
        <div>
          <h3>Reviewer</h3>
          <button onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>{' '}
          <button onClick={download}>Download .md</button>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{content}</pre>
          <p>
            <i>Check this reviewer against the reading. The AI can make mistakes.</i>
          </p>
        </div>
      )}

      <h3>Saved reviewers for this reading</h3>
      {saved.length === 0 && <p>None yet.</p>}
      <ul>
        {saved.map((r) => (
          <li key={r.id}>
            {formatDate(r.createdAt)} ({r.length}) <button onClick={() => setContent(r.content)}>Open</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
