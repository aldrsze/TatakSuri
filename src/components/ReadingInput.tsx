// frontend/src/components/ReadingInput.tsx
// Upload a file or paste text, and pick from saved readings.

import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import {
  ACCEPTED_FILE_TYPES,
  extractFromFile,
  extractFromPaste,
  type ExtractedDocument,
} from '../extract';
import { addReading, deleteReading, listReadings } from '../db/repositories';
import type { Reading } from '../db/types';
import { errorMessage, formatDate } from './common';

export default function ReadingInput({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (reading: Reading | null) => void;
}) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');

  const refresh = useCallback(async () => setReadings(await listReadings()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveDoc(doc: ExtractedDocument) {
    const reading = await addReading({
      title: doc.title,
      text: doc.text,
      sourceType: doc.sourceType,
      fileName: doc.fileName,
    });
    setWarnings(doc.warnings ?? []);
    await refresh();
    onSelect(reading);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    setWarnings([]);
    setBusy(true);
    try {
      await saveDoc(await extractFromFile(file, (done, total) => setProgress(`Reading page ${done} of ${total}…`)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function onPaste() {
    setError('');
    setWarnings([]);
    setBusy(true);
    try {
      await saveDoc(extractFromPaste(pasteText, pasteTitle));
      setPasteText('');
      setPasteTitle('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(r: Reading) {
    if (!window.confirm(`Delete "${r.title}" and everything generated from it?`)) return;
    await deleteReading(r.id);
    if (r.id === selectedId) onSelect(null);
    await refresh();
  }

  return (
    <section>
      <h2>Reading</h2>

      <h3>Upload a file</h3>
      <input type="file" accept={ACCEPTED_FILE_TYPES} onChange={onFile} disabled={busy} />
      <p>PDF, DOCX, PPTX, TXT, or MD</p>

      <h3>Or paste text</h3>
      <input
        placeholder="Title (optional)"
        value={pasteTitle}
        onChange={(e) => setPasteTitle(e.target.value)}
        disabled={busy}
      />
      <br />
      <textarea
        rows={6}
        cols={60}
        placeholder="Paste your reading here"
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        disabled={busy}
      />
      <br />
      <button onClick={onPaste} disabled={busy || !pasteText.trim()}>
        Use pasted text
      </button>

      {busy && <p>{progress || 'Working…'}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {warnings.map((w) => (
        <p key={w}>Note: {w}</p>
      ))}

      <h3>Saved readings</h3>
      {readings.length === 0 && <p>None yet.</p>}
      <ul>
        {readings.map((r) => (
          <li key={r.id}>
            <b>{r.title}</b> ({r.sourceType}, {r.text.length.toLocaleString()} characters, {formatDate(r.createdAt)}){' '}
            {r.id === selectedId ? (
              <b>[selected]</b>
            ) : (
              <button onClick={() => onSelect(r)}>Select</button>
            )}{' '}
            <button onClick={() => onDelete(r)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}