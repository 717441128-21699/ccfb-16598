#!/usr/bin/env node
/**
 * Zero-dependency AudioWorklet smoke test.
 * Loads public/worklets/bubble-worklet.js in a Node VM and feeds synthetic
 * bubbles, compressor hum, broadband dog/impact noise and speech-like sound.
 */
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const workletUrl = new URL('../public/worklets/bubble-worklet.js', import.meta.url);
const source = fs.readFileSync(fileURLToPath(workletUrl), 'utf8');
let ProcessorClass;
const messages = [];

class AudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage: (msg) => messages.push(msg),
      close() {},
    };
  }
}

const context = {
  AudioWorkletProcessor,
  registerProcessor: (_name, cls) => {
    ProcessorClass = cls;
  },
  sampleRate: 48000,
  currentTime: 0,
  console,
  Math,
  Float32Array,
};
vm.createContext(context);
vm.runInContext(source, context);

const processor = new ProcessorClass();
const sr = 48000;

function runSamples(samples) {
  messages.length = 0;
  for (let i = 0; i < samples.length; i += 128) {
    const channel = new Float32Array(128);
    channel.set(samples.subarray(i, i + 128));
    context.currentTime = i / sr;
    processor.process([[channel]]);
  }
}

const silence = (ms) => new Float32Array(Math.floor((sr * ms) / 1000));

function bubble(freq = 620, ms = 150, amp = 0.32) {
  const n = Math.floor((sr * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / sr;
    const attack = Math.min(1, i / (sr * 0.006));
    const decay = Math.exp(-t * 24);
    out[i] =
      amp * attack * decay * Math.sin(2 * Math.PI * freq * t) +
      (Math.random() - 0.5) * 0.006;
  }
  return out;
}

function hum(ms = 1200) {
  const n = Math.floor((sr * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] =
      0.18 * Math.sin((2 * Math.PI * 110 * i) / sr) +
      0.04 * Math.sin((2 * Math.PI * 55 * i) / sr);
  }
  return out;
}

function noiseBurst(ms = 160) {
  const n = Math.floor((sr * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const env = Math.exp(-(i / sr) * 12);
    out[i] = 0.4 * env * (Math.random() * 2 - 1);
  }
  return out;
}

function speechLike(ms = 620) {
  const n = Math.floor((sr * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / sr;
    const mod = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.5 * t);
    const envelope = Math.min(1, i / 2000) * Math.min(1, (n - i) / 3000);
    out[i] =
      (0.22 *
        mod *
        envelope *
        (Math.sin(2 * Math.PI * 240 * t) +
          0.6 * Math.sin(2 * Math.PI * 480 * t) +
          0.35 * Math.sin(2 * Math.PI * 760 * t))) /
      1.95;
  }
  return out;
}

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

let failed = false;
for (const [name, samples, expectedBubbles] of [
  ['620 Hz airlock bubble', concat(bubble(), silence(500)), 1],
  ['900 Hz airlock bubble', concat(bubble(900, 110, 0.28), silence(500)), 1],
  ['fridge/AC low hum', concat(hum(), silence(300)), 0],
  ['dog / broadband impact', concat(noiseBurst(), silence(500)), 0],
  ['speech-like syllable', concat(speechLike(), silence(500)), 0],
]) {
  runSamples(samples);
  const bubbles = messages.filter((m) => m.type === 'bubble');
  const rejects = messages.filter((m) => m.type === 'reject');
  const pass = bubbles.length === expectedBubbles;
  failed ||= !pass;
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${name}: bubbles=${bubbles.length}, rejects=${rejects
      .map((r) => r.reason)
      .join('|') || '-'}`,
  );
  if (bubbles[0]) {
    console.log(
      `     peak=${Math.round(bubbles[0].features.peakHz)}Hz duration=${Math.round(
        bubbles[0].features.durationMs,
      )}ms`,
    );
  }
}

process.exit(failed ? 1 : 0);
