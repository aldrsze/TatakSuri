// frontend/src/ai/worker.ts
// Runs the WebLLM engine off the main thread so the UI never freezes while generating.

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
