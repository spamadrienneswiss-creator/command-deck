// Speech-to-text worker. Runs Whisper off the main thread so the console
// never freezes while it transcribes.
const LIB_URL = new URL('../node_modules/@huggingface/transformers/dist/transformers.min.js', import.meta.url).href;
const WASM_DIR = new URL('../node_modules/@huggingface/transformers/dist/', import.meta.url).href;
const MODEL_ID = 'Xenova/whisper-base.en';

let asrPromise = null;

function load() {
  if (asrPromise) return asrPromise;
  const files = new Map();
  asrPromise = (async () => {
    const T = await import(LIB_URL);
    T.env.allowLocalModels = false;
    T.env.useBrowserCache = true;
    T.env.backends.onnx.wasm.wasmPaths = WASM_DIR;
    T.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
      ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))
      : 1;
    return T.pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (p) => {
        if (p.status === 'progress' && p.file && p.total) {
          files.set(p.file, { loaded: p.loaded, total: p.total });
          let loaded = 0;
          let total = 0;
          files.forEach((f) => { loaded += f.loaded; total += f.total; });
          self.postMessage({ type: 'progress', progress: total ? Math.round((loaded / total) * 100) : 0 });
        }
      }
    });
  })().catch((err) => {
    asrPromise = null;
    throw err;
  });
  return asrPromise;
}

self.onmessage = async (e) => {
  const { id, type, audio } = e.data || {};
  try {
    if (type === 'load') {
      await load();
      self.postMessage({ id, type: 'ready' });
    } else if (type === 'transcribe') {
      const asr = await load();
      const out = await asr(audio, { chunk_length_s: 30 });
      self.postMessage({ id, type: 'result', text: (out && out.text) || '' });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: (err && err.message) || String(err) });
  }
};
