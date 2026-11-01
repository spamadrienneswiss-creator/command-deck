// Data Recap transcription worker: long recordings through Whisper, a few minutes at a time,
// with timestamps. Separate from the voice-command worker so asking the computer something
// mid-transcription still gets a quick answer. Same model, so it's already downloaded.
const LIB_URL = new URL('../node_modules/@huggingface/transformers/dist/transformers.min.js', import.meta.url).href;
const WASM_DIR = new URL('../node_modules/@huggingface/transformers/dist/', import.meta.url).href;
const MODEL_ID = 'Xenova/whisper-base.en';

let asrPromise = null;
let device = 'wasm';

async function make(T, dev) {
  const opts = { device: dev };
  if (dev === 'webgpu') opts.dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };
  return T.pipeline('automatic-speech-recognition', MODEL_ID, opts);
}

function load() {
  if (asrPromise) return asrPromise;
  asrPromise = (async () => {
    const T = await import(LIB_URL);
    T.env.allowLocalModels = false;
    T.env.useBrowserCache = true;
    T.env.backends.onnx.wasm.wasmPaths = WASM_DIR;
    T.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
      ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))
      : 1;
    // The graphics card is far faster when it's available; the CPU always works.
    if (self.navigator && self.navigator.gpu) {
      try { const p = await make(T, 'webgpu'); device = 'webgpu'; return { T, asr: p }; } catch (e) { /* fall back */ }
    }
    device = 'wasm';
    return { T, asr: await make(T, 'wasm') };
  })().catch((err) => { asrPromise = null; throw err; });
  return asrPromise;
}

async function run(audio) {
  const { T, asr } = await load();
  const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
  try {
    return await asr(audio, opts);
  } catch (e) {
    if (device !== 'webgpu') throw e;
    // The graphics card gave up partway: finish on the CPU.
    device = 'wasm';
    const cpu = await make(T, 'wasm');
    asrPromise = Promise.resolve({ T, asr: cpu });
    return cpu(audio, opts);
  }
}

self.onmessage = async (e) => {
  const { id, type, audio, offset } = e.data || {};
  try {
    if (type === 'load') {
      await load();
      self.postMessage({ id, type: 'ready', device });
    } else if (type === 'transcribe') {
      const out = await run(audio);
      const base = Number(offset) || 0;
      const segments = ((out && out.chunks) || [])
        .map((c) => ({ t: base + ((c.timestamp && c.timestamp[0]) || 0), text: String(c.text || '').trim() }))
        .filter((s) => s.text && !/^\[(?:blank_audio|music|silence)\]$/i.test(s.text));
      if (!segments.length && out && out.text && out.text.trim()) segments.push({ t: base, text: out.text.trim() });
      self.postMessage({ id, type: 'result', segments, device });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: (err && err.message) || String(err) });
  }
};
