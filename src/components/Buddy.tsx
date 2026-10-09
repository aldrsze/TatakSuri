// frontend/src/components/Buddy.tsx
// Reading Buddy: Socratic chat that asks questions instead of giving answers.

import { useRef, useState } from 'react';
import { askBuddy } from '../ai/readingBuddy';
import { logSession, updateSessionMessages } from '../db/repositories';
import type { ChatMessage, Reading } from '../db/types';
import { NeedsModel, errorMessage, isAbort } from './common';

export default function Buddy({ reading }: { reading: Reading }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sessionId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run(userMessage?: string) {
    setError('');
    setBusy(true);
    setDraft('');

    const history = messages;
    const next: ChatMessage[] = userMessage
      ? [...messages, { role: 'user', content: userMessage }]
      : messages;
    setMessages(next);

    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      if (!sessionId.current) {
        sessionId.current = (await logSession(reading.id, 'buddy')).id;
      }
      const reply = await askBuddy({
        readingText: reading.text,
        history,
        userMessage,
        onToken: (_token, full) => setDraft(full),
        signal: ctrl.signal,
      });
      const final: ChatMessage[] = [...next, { role: 'assistant', content: reply }];
      setMessages(final);
      await updateSessionMessages(sessionId.current, final);
    } catch (e) {
      if (!isAbort(e)) setError(errorMessage(e));
    } finally {
      setDraft('');
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    run(text);
  }

  function reset() {
    setMessages([]);
    setDraft('');
    sessionId.current = null;
  }

  return (
    <section>
      <h2>Reading Buddy</h2>
      <p>Reading Buddy asks guiding questions so you work out the answers yourself.</p>

      <NeedsModel>
        {messages.length === 0 && !busy && <button onClick={() => run()}>Start</button>}

        {messages.map((m, i) => (
          <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
            <b>{m.role === 'user' ? 'You' : 'Buddy'}:</b> {m.content}
          </p>
        ))}

        {busy && draft && (
          <p style={{ whiteSpace: 'pre-wrap' }}>
            <b>Buddy:</b> {draft}
          </p>
        )}
        {busy && !draft && <p>Buddy is thinking…</p>}
        {busy && <button onClick={() => abort.current?.abort()}>Stop</button>}

        {messages.length > 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              size={60}
              placeholder="Type your answer or thought"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
            />{' '}
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>{' '}
            <button type="button" onClick={reset} disabled={busy}>
              New conversation
            </button>
          </form>
        )}

        {error && <p style={{ color: 'red' }}>{error}</p>}
      </NeedsModel>
    </section>
  );
}
