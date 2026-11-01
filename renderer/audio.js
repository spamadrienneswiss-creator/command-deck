// Data Recap: turns a recording (usually an .m4a from iPhone Voice Memos) into 16 kHz mono
// samples for Whisper, without ever holding the full-quality audio in memory.
//
// .m4a / .mp4: the file is read piece by piece (mp4 boxes → AAC frames), each frame decoded with
// WebCodecs and shrunk straight to 16 kHz. An hour of speech ends up as about 230 MB of samples.
// Anything else (mp3, wav, …): the browser's own decoder, then resampled.

export const TARGET_RATE = 16000;

// ---------------------------------------------------------------- mp4 parsing
function u32(v, o) { return v.getUint32(o); }
function u64(v, o) { return v.getUint32(o) * 4294967296 + v.getUint32(o + 4); }
function type4(v, o) { return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)); }

function* boxes(v, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(v, o);
    const type = type4(v, o + 4);
    let head = 8;
    if (size === 1) { size = u64(v, o + 8); head = 16; } else if (size === 0) size = end - o;
    if (size < head || o + size > end) return;
    yield { type, start: o, body: o + head, end: o + size };
    o += size;
  }
}
function child(v, box, type) {
  for (const b of boxes(v, box.body, box.end)) if (b.type === type) return b;
  return null;
}
function path(v, box, types) {
  let b = box;
  for (const t of types) { b = b && child(v, b, t); if (!b) return null; }
  return b;
}

// MPEG-4 descriptor length: up to four bytes, seven bits each.
function descLen(v, o) {
  let len = 0;
  let n = 0;
  let b;
  do { b = v.getUint8(o + n); len = (len << 7) | (b & 0x7f); n++; } while ((b & 0x80) && n < 4);
  return { len, n };
}

function parseEsds(v, esds) {
  let o = esds.body + 4; // version + flags
  const end = esds.end;
  let objectType = 0x40;
  while (o < end) {
    const tag = v.getUint8(o);
    const { len, n } = descLen(v, o + 1);
    const body = o + 1 + n;
    if (tag === 0x03) { // ES_Descriptor
      const flags = v.getUint8(body + 2);
      let p = body + 3;
      if (flags & 0x80) p += 2;
      if (flags & 0x40) p += 1 + v.getUint8(p);
      if (flags & 0x20) p += 2;
      o = p;
      continue;
    }
    if (tag === 0x04) { // DecoderConfigDescriptor
      objectType = v.getUint8(body);
      o = body + 13;
      continue;
    }
    if (tag === 0x05) { // DecoderSpecificInfo = AudioSpecificConfig
      const config = new Uint8Array(v.buffer, v.byteOffset + body, len).slice();
      let aot = config[0] >> 3;
      if (aot === 31 && config.length > 1) aot = 32 + (((config[0] & 7) << 3) | (config[1] >> 5));
      return { config, objectType, aot };
    }
    o = body + len;
  }
  return null;
}

/** Finds the first audio track of an mp4/m4a and the byte position of every encoded frame. */
export function parseMp4(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const root = { body: 0, end: bytes.byteLength };
  const moov = child(v, root, 'moov');
  if (!moov) return null;
  for (const trak of boxes(v, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(v, trak, 'mdia');
    const hdlr = mdia && child(v, mdia, 'hdlr');
    if (!hdlr || type4(v, hdlr.body + 8) !== 'soun') continue;
    const mdhd = child(v, mdia, 'mdhd');
    const ver = v.getUint8(mdhd.body);
    const timescale = u32(v, mdhd.body + (ver === 1 ? 20 : 12));
    const duration = ver === 1 ? u64(v, mdhd.body + 24) : u32(v, mdhd.body + 16);
    const stbl = path(v, mdia, ['minf', 'stbl']);
    if (!stbl) continue;
    const stsd = child(v, stbl, 'stsd');
    const entry = stsd && boxes(v, stsd.body + 8, stsd.end).next().value;
    if (!entry) continue;
    const codec4 = entry.type; // mp4a, alac, …
    const channels = v.getUint16(entry.body + 16);
    const sampleRate = u32(v, entry.body + 24) >>> 16;
    let esdsInfo = null;
    for (const b of boxes(v, entry.body + 28, entry.end)) {
      if (b.type === 'esds') esdsInfo = parseEsds(v, b);
      if (b.type === 'wave') { const e = child(v, b, 'esds'); if (e) esdsInfo = parseEsds(v, e); }
    }
    // Frame sizes
    const stsz = child(v, stbl, 'stsz');
    const fixed = u32(v, stsz.body + 4);
    const count = u32(v, stsz.body + 8);
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || u32(v, stsz.body + 12 + i * 4);
    // Chunk offsets
    const stco = child(v, stbl, 'stco');
    const co64 = child(v, stbl, 'co64');
    const cbox = stco || co64;
    const nChunks = u32(v, cbox.body + 4);
    const chunkOff = new Float64Array(nChunks);
    for (let i = 0; i < nChunks; i++) chunkOff[i] = stco ? u32(v, cbox.body + 8 + i * 4) : u64(v, cbox.body + 8 + i * 8);
    // Frames per chunk
    const stsc = child(v, stbl, 'stsc');
    const nRuns = u32(v, stsc.body + 4);
    const runs = [];
    for (let i = 0; i < nRuns; i++) runs.push([u32(v, stsc.body + 8 + i * 12), u32(v, stsc.body + 12 + i * 12)]);
    const offsets = new Float64Array(count);
    let s = 0;
    for (let c = 0; c < nChunks && s < count; c++) {
      let per = runs[0] ? runs[0][1] : 1;
      for (let r = runs.length - 1; r >= 0; r--) if (c + 1 >= runs[r][0]) { per = runs[r][1]; break; }
      let o = chunkOff[c];
      for (let k = 0; k < per && s < count; k++, s++) { offsets[s] = o; o += sizes[s]; }
    }
    // Frame durations (for timestamps)
    const stts = child(v, stbl, 'stts');
    const deltas = new Uint32Array(count);
    if (stts) {
      const n = u32(v, stts.body + 4);
      let i = 0;
      for (let e = 0; e < n && i < count; e++) {
        const c = u32(v, stts.body + 8 + e * 8);
        const d = u32(v, stts.body + 12 + e * 8);
        for (let k = 0; k < c && i < count; k++) deltas[i++] = d;
      }
    }
    return {
      codec: codec4 === 'mp4a' ? `mp4a.40.${esdsInfo ? esdsInfo.aot : 2}` : codec4,
      description: esdsInfo ? esdsInfo.config : null,
      sampleRate, channels, timescale,
      durationSec: timescale ? duration / timescale : 0,
      count, sizes, offsets, deltas
    };
  }
  return null;
}

// ---------------------------------------------------------------- resampling
/**
 * Streams mono audio down to 16 kHz by averaging each output sample's slice of input
 * (a box filter: crude, but plenty for speech recognition and cheap enough for an hour of audio).
 */
export class Downsampler {
  constructor(inRate, outRate = TARGET_RATE, expectedSec = 0) {
    this.ratio = inRate / outRate;
    this.out = new Float32Array(Math.max(outRate * 10, Math.ceil(expectedSec * outRate) + outRate));
    this.n = 0;
    this.pos = 0; // input samples consumed
    this.sum = 0;
    this.cnt = 0;
    this.next = this.ratio; // input position where the current output sample ends
  }
  push(mono) {
    for (let i = 0; i < mono.length; i++) {
      this.sum += mono[i];
      this.cnt++;
      this.pos++;
      if (this.pos >= this.next) {
        this.emit(this.sum / this.cnt);
        this.sum = 0;
        this.cnt = 0;
        this.next += this.ratio;
      }
    }
  }
  emit(x) {
    if (this.n >= this.out.length) {
      const bigger = new Float32Array(Math.ceil(this.out.length * 1.5));
      bigger.set(this.out);
      this.out = bigger;
    }
    this.out[this.n++] = x;
  }
  finish() {
    if (this.cnt) this.emit(this.sum / this.cnt);
    return this.out.subarray(0, this.n);
  }
}

function mixToMono(audioData) {
  const frames = audioData.numberOfFrames;
  const ch = audioData.numberOfChannels;
  const mono = new Float32Array(frames);
  const tmp = new Float32Array(frames);
  const planar = /planar/.test(audioData.format);
  if (planar) {
    for (let c = 0; c < ch; c++) {
      audioData.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
      for (let i = 0; i < frames; i++) mono[i] += tmp[i] / ch;
    }
  } else {
    const inter = new Float32Array(frames * ch);
    audioData.copyTo(inter, { planeIndex: 0, format: 'f32' });
    for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < ch; c++) s += inter[i * ch + c]; mono[i] = s / ch; }
  }
  return mono;
}

// ---------------------------------------------------------------- decoding
async function decodeMp4(bytes, info, onProgress) {
  if (typeof AudioDecoder === 'undefined') throw new Error('no-webcodecs');
  const cfg = { codec: info.codec, sampleRate: info.sampleRate, numberOfChannels: info.channels };
  if (info.description) cfg.description = info.description;
  const support = await AudioDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!support.supported) throw new Error('unsupported-codec');
  let ds = null;
  let failure = null;
  const dec = new AudioDecoder({
    output: (ad) => {
      try {
        if (!ds) ds = new Downsampler(ad.sampleRate, TARGET_RATE, info.durationSec);
        ds.push(mixToMono(ad));
      } finally { ad.close(); }
    },
    error: (e) => { failure = e; }
  });
  dec.configure(cfg);
  let ts = 0;
  const scale = 1e6 / (info.timescale || info.sampleRate);
  for (let i = 0; i < info.count; i++) {
    if (failure) break;
    const start = info.offsets[i];
    const data = bytes.subarray(start, start + info.sizes[i]);
    dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(ts * scale), data }));
    ts += info.deltas[i] || 1024;
    // Don't let the decoder's queue run away with memory; let it catch up now and then.
    if (dec.decodeQueueSize > 400) await new Promise((r) => setTimeout(r, 0));
    if (i % 2000 === 0) { onProgress && onProgress(i / info.count); await new Promise((r) => setTimeout(r, 0)); }
  }
  if (!failure) await dec.flush();
  dec.close();
  if (failure) throw failure;
  if (!ds) throw new Error('no-audio');
  return ds.finish();
}

async function decodeWhole(bytes) {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const ds = new Downsampler(buf.sampleRate, TARGET_RATE, buf.duration);
    const ch = buf.numberOfChannels;
    const step = buf.sampleRate * 10;
    for (let o = 0; o < buf.length; o += step) {
      const n = Math.min(step, buf.length - o);
      const mono = new Float32Array(n);
      for (let c = 0; c < ch; c++) {
        const d = buf.getChannelData(c).subarray(o, o + n);
        for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
      }
      ds.push(mono);
    }
    return ds.finish();
  } finally {
    ctx.close().catch(() => {});
  }
}

/** Recording bytes → { samples: Float32Array at 16 kHz mono, durationSec }. */
export async function decodeRecording(bytes, onProgress) {
  const info = (() => { try { return parseMp4(bytes); } catch (e) { return null; } })();
  let samples = null;
  if (info && info.count) {
    try { samples = await decodeMp4(bytes, info, onProgress); } catch (e) { samples = null; }
  }
  if (!samples) samples = await decodeWhole(bytes);
  onProgress && onProgress(1);
  return { samples, durationSec: samples.length / TARGET_RATE };
}
