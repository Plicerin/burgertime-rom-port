// Compares two WAV recordings of the same session (e.g. the port's
// tools/render-audio.mjs output and MAME's -wavwrite): finds the time offset by
// cross-correlating loudness envelopes, then reports level ratio, envelope
// correlation, and waveform correlation per 1 s window after alignment.
//   node tools/compare-wav.mjs <a.wav> <b.wav>
import { readFileSync } from 'node:fs';

function readWav(path) {
  const b = readFileSync(path);
  let o = 12, fmt = null, data = null;
  while (o < b.length) {
    const id = b.toString('latin1', o, o + 4), len = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = b.subarray(o + 8, o + 8 + len);
    o += 8 + len + (len & 1);
  }
  const n = data.length / 2 / fmt.channels;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let v = 0;
    for (let c = 0; c < fmt.channels; c += 1) v += data.readInt16LE((i * fmt.channels + c) * 2);
    s[i] = v / fmt.channels / 32768;
  }
  return { ...fmt, s };
}

const [pa, pb] = process.argv.slice(2);
const A = readWav(pa), B = readWav(pb);
console.log(`a: ${A.rate} Hz ${A.channels} ch ${(A.s.length / A.rate).toFixed(2)} s; b: ${B.rate} Hz ${B.channels} ch ${(B.s.length / B.rate).toFixed(2)} s`);
if (A.rate !== B.rate) throw new Error('sample rates differ');
const rate = A.rate;
const rms = (s, from, len) => { let e = 0; for (let i = from; i < from + len && i < s.length; i += 1) e += s[i] * s[i]; return Math.sqrt(e / len); };
const corr = (x, y) => {
  const n = Math.min(x.length, y.length);
  let mx = 0, my = 0; for (let i = 0; i < n; i += 1) { mx += x[i]; my += y[i]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy || 1);
};
// offset: best sample lag of b against a within +-100 ms, on the waveform
let best = 0, bestC = -Infinity;
const probeFrom = Math.floor(rate * 2), probeLen = Math.floor(rate * 4);
for (let lag = -Math.floor(rate * 0.1); lag <= Math.floor(rate * 0.1); lag += 1) {
  let c = 0;
  for (let i = probeFrom; i < probeFrom + probeLen; i += 4) { const j = i + lag; if (j >= 0 && j < B.s.length) c += A.s[i] * B.s[j]; }
  if (c > bestC) { bestC = c; best = lag; }
}
console.log(`b lags a by ${best} samples (${(best / rate * 1000).toFixed(2)} ms)`);
const n = Math.min(A.s.length, B.s.length - Math.max(0, best)) - Math.max(0, -best);
const a = A.s.subarray(Math.max(0, -best), Math.max(0, -best) + n);
const b = B.s.subarray(Math.max(0, best), Math.max(0, best) + n);
const ra = rms(a, 0, a.length), rb = rms(b, 0, b.length);
console.log(`RMS a ${ra.toFixed(4)} b ${rb.toFixed(4)} (b/a ${(rb / ra).toFixed(3)}); waveform correlation over the whole run ${corr(a, b).toFixed(4)}`);
const lines = [];
for (let t = 0; t + rate <= n; t += rate) lines.push(`${(t / rate).toFixed(0).padStart(3)}s rms ${rms(a, t, rate).toFixed(3)}/${rms(b, t, rate).toFixed(3)} corr ${corr(a.subarray(t, t + rate), b.subarray(t, t + rate)).toFixed(3)}`);
console.log(lines.join('\n'));

// phase-insensitive check: magnitude spectra (4096-point FFT, Hann window),
// correlated per 1 s window, and per frequency band over the whole run
function fftMag(x) {
  const N = x.length, re = Float64Array.from(x), im = new Float64Array(N);
  for (let i = 1, j = 0; i < N; i += 1) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k += 1) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const ur = re[i + k], ui = im[i + k];
      const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
    }
  }
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i += 1) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}
const W = 4096;
const hann = Float64Array.from({ length: W }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (W - 1)));
const spec = (s, from) => fftMag(Float64Array.from({ length: W }, (_, i) => (s[from + i] ?? 0) * hann[i]));
const specLines = [];
const sumA = new Float64Array(W / 2), sumB = new Float64Array(W / 2);
for (let t = 0; t + rate <= n; t += rate) {
  const sa = new Float64Array(W / 2), sb = new Float64Array(W / 2);
  for (let k = t; k + W <= t + rate; k += W / 2) { const x = spec(a, k), y = spec(b, k); for (let i = 0; i < W / 2; i += 1) { sa[i] += x[i]; sb[i] += y[i]; } }
  for (let i = 0; i < W / 2; i += 1) { sumA[i] += sa[i]; sumB[i] += sb[i]; }
  specLines.push(`${(t / rate).toFixed(0)}s ${corr(sa, sb).toFixed(3)}`);
}
console.log(`spectrum correlation per second: ${specLines.join('  ')}`);
const band = (lo, hi) => { let x = 0, y = 0; for (let i = Math.floor(lo * W / rate); i < Math.floor(hi * W / rate); i += 1) { x += sumA[i]; y += sumB[i]; } return (y / x).toFixed(3); };
console.log(`b/a energy by band: 0-250 Hz ${band(0, 250)}, 250-1k ${band(250, 1000)}, 1k-4k ${band(1000, 4000)}, 4k-12k ${band(4000, 12000)}, 12k-24k ${band(12000, 24000)}`);
