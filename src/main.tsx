import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Dev-only helpers so you can test from the browser console
if (import.meta.env.DEV) {
  import('./db/smoke').then((m) => ((window as any).runDbSmokeTest = m.runDbSmokeTest));
  import('./ai/engine').then((m) => ((window as any).ai = m));
  import('./ai/jsonOutput').then((m) => ((window as any).aiJson = m));
  import('./ai/generators').then((m) => ((window as any).gen = m));
  import('./ai/readingBuddy').then((m) => ((window as any).buddy = m));
  import('./ai/argumentChecker').then((m) => ((window as any).arg = m));
  import('./extract').then((m) => ((window as any).ex = m));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);