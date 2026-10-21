// Neural text-to-speech worker (Kokoro-82M). Runs on this computer, off the
// main thread. The voice model (~90 MB) downloads once, then works offline.
const LIB_URL = new URL('../node_modules/kokoro-js/dist/kokoro.web.js', import.meta.url).href;
const WASM_DIR = new URL('../node_modules/@huggingface/transformers/dist/', import.meta.url).href;
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let ttsPromise = null;

function load() {
  if (ttsPromise) return ttsPromise;
  const files = new Map();
  ttsPromise = (async () => {
    const K = await import(LIB_URL);
    K.env.wasmPaths = WASM_DIR;
    return K.KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
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
    ttsPromise = null;
    throw err;
  });
  return ttsPromise;
}

self.onmessage = async (e) => {
  const { id, type, text, voice, speed } = e.data || {};
  try {
    if (type === 'load') {
      await load();
      self.postMessage({ id, type: 'ready' });
    } else if (type === 'speak') {
      const tts = await load();
      const out = await tts.generate(text, { voice: voice || 'bm_george', speed: speed || 1 });
      const samples = out.audio;
      self.postMessage({ id, type: 'audio', samples, rate: out.sampling_rate }, [samples.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: (err && err.message) || String(err) });
  }
};
