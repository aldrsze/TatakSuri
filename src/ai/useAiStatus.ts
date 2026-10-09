// frontend/src/ai/useAiStatus.ts
// React hook: re-renders whenever the AI engine status changes (loading %, ready, error).

import { useSyncExternalStore } from 'react';
import { getStatus, subscribe } from './engine';

export function useAiStatus() {
  return useSyncExternalStore(subscribe, getStatus);
}
