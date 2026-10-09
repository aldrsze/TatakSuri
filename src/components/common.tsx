// frontend/src/components/common.tsx
// Small shared helpers for the basic UI.

import type { ReactNode } from 'react';
import { useAiStatus } from '../ai/useAiStatus';

/** Shows its children only once the AI model is loaded. */
export function NeedsModel({ children }: { children: ReactNode }) {
  const status = useAiStatus();
  if (status.state !== 'ready') {
    return <p><i>Load the AI model first (see the "AI model" section at the top).</i></p>;
  }
  return <>{children}</>;
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong.';

export const formatDate = (ms: number) => new Date(ms).toLocaleString();
