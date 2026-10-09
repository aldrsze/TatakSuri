// frontend/src/components/ModelLoader.tsx
// Pick a model, download/load it, and see progress.

import { useEffect, useState } from 'react';
import { getAvailableModels, getSelectedModelId, isModelCached, loadModel } from '../ai/engine';
import { useAiStatus } from '../ai/useAiStatus';

export default function ModelLoader() {
  const status = useAiStatus();
  const models = getAvailableModels();

  const [modelId, setModelId] = useState(() => {
    const saved = getSelectedModelId();
    return models.some((m) => m.id === saved) ? saved : (models[0]?.id ?? saved);
  });
  const [cached, setCached] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    isModelCached(modelId)
      .then((c) => alive && setCached(c))
      .catch(() => alive && setCached(null));
    return () => {
      alive = false;
    };
  }, [modelId, status.state]);

  const loading = status.state === 'loading';
  const alreadyLoaded = status.state === 'ready' && status.modelId === modelId;

  return (
    <section>
      <h2>AI model</h2>

      {models.length === 0 && <p>No configured models were found in this web-llm version.</p>}

      <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={loading}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>{' '}
      <button disabled={loading || alreadyLoaded || !modelId} onClick={() => loadModel(modelId).catch(() => {})}>
        {alreadyLoaded ? 'Loaded' : cached ? 'Load model' : 'Download & load model'}
      </button>
      <p>
        Downloaded on this device (works offline):{' '}
        {cached === null ? 'unknown' : cached ? 'yes' : 'no, first load will download it'}
      </p>

      {status.state === 'idle' && <p>Status: not loaded</p>}
      {status.state === 'loading' && (
        <p>
          <progress value={status.progress} max={1} /> {Math.round(status.progress * 100)}%
          <br />
          {status.text}
        </p>
      )}
      {status.state === 'ready' && <p>Status: ready ({status.modelId})</p>}
      {status.state === 'unsupported' && <p>Not supported: {status.reason}</p>}
      {status.state === 'error' && <p>Error: {status.message}</p>}
    </section>
  );
}
