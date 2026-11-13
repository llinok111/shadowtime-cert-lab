// Timing: 1 cold run + 15 samples, each sample = 200 full-data passes.
import { readFileSync, writeFileSync } from 'node:fs';
import { shadowCertificate, shadowedAt, timeScaleForBudget } from '../src/core.mjs';
import { sampleAtFps, missedSubFrameEvents } from '../baseline/sampled.mjs';

const data = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url)));
const scenes = data.scenes;

function ms(fn, loops = 1) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < loops; i++) fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const p95 = s[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return {
    min: s[0],
    median: s[Math.floor(n / 2)],
    p95,
    max: s[n - 1],
    mean,
    stddev: Math.sqrt(variance),
    relStddev: Math.sqrt(variance) / mean,
    samples: n,
  };
}

// Cold start: first certificate call on every scene.
let coldCert = 0;
const cold0 = process.hrtime.bigint();
for (const s of scenes) shadowCertificate(s);
coldCert = Number(process.hrtime.bigint() - cold0) / 1e6;

// Warm: 15 independent samples, 200 whole-dataset passes per sample.
const certRuns = [];
const queryRuns = [];
const repairRuns = [];
for (let k = 0; k < 15; k++) {
  certRuns.push(ms(() => { for (const s of scenes) shadowCertificate(s); }, 2000) / 2000);
  queryRuns.push(ms(() => {
    for (let i = 0; i < 2000; i++) shadowedAt(scenes[i % scenes.length], (i * 0.6180339887) % 1);
  }, 10) / 10);
  repairRuns.push(ms(() => {
    for (const s of scenes) timeScaleForBudget(s, 1 / 60);
  }, 50) / 50);
}

// Baseline: 60 Hz frame sampling over every scene, same style.
const baseRuns = [];
for (let k = 0; k < 15; k++) {
  baseRuns.push(ms(() => { for (const s of scenes) sampleAtFps(s, 60); }, 50) / 50);
}

const certs = scenes.map((s) => shadowCertificate(s));
const subFrame = certs.reduce((n, c) => n + c.subFrameCount, 0);
let missed = 0;
for (const s of scenes) {
  const c = shadowCertificate(s);
  missed += missedSubFrameEvents(s, c.intervals, 60).missed;
}
const certificates = certs.reduce((n, c) => n + c.intervalCount, 0);
const triangles = scenes.reduce((n, s) => n + s.triangles.length, 0);

const totalCertMedian = stats(certRuns).median;
const totalBaseMedian = stats(baseRuns).median;
const result = {
  command: 'node bench/bench.mjs',
  data: { scenes: scenes.length, triangles },
  coldStartMs: coldCert,
  samples: 15,
  loopsPerSample: 2000,
  certificate: { ...stats(certRuns), perSceneMedianMs: stats(certRuns).median / scenes.length },
  queryAt: { ...stats(queryRuns), perQueryUs: (stats(queryRuns).median / 2000) * 1000 },
  timeScale: stats(repairRuns),
  baseline60Hz: stats(baseRuns),
  speedupVsFrameSampling: totalBaseMedian / totalCertMedian,
  intervals: { total: certificates, subFrame, missedBy60Hz: missed },
  repair: {
    targetSeconds: 1 / 60,
    scenesNeedingSpeedup: certs.filter((c) => c.maxIntervalSeconds > 1 / 60).length,
    speeds: Object.fromEntries(scenes.map((s) => [s.id, timeScaleForBudget(s, 1 / 60).appliedSpeed])),
  },
  note: 'Timing in ms for one whole-dataset pass (12 scenes). Cold start is the first uncached call.',
};

writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));