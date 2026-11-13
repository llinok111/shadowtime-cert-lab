// K -> continuum convergence of the sampled area-light model, measured on the
// area-grid scene. Exact for each K-point model; the K=16 profile is NOT a
// continuous rectangle light. This script quantifies that gap.
import { readFileSync, writeFileSync } from 'node:fs';
import { coverageProfile } from '../src/core.mjs';

const data = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url)));
const scene = data.scenes.find((s) => s.lightGrid);
const rect = scene.lightGrid;

function profileFor(K) {
  const nx = Math.round(Math.sqrt(K));
  return coverageProfile(scene, { ...rect, nx, ny: nx });
}

function values(profile, N) {
  const out = new Float64Array(N);
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    while (seg + 1 < profile.segments.length && t > profile.segments[seg].hi) seg++;
    const s = profile.segments[seg];
    out[i] = t >= s.lo && t <= s.hi ? s.count / profile.K : 0;
  }
  return out;
}

const N = 4096;
const Ks = [4, 16, 64, 256, 1024];
const profiles = new Map(Ks.map((K) => [K, profileFor(K)]));
const ref = values(profiles.get(1024), N);
const rows = [];
for (const K of Ks) {
  const p = profiles.get(K);
  const v = values(p, N);
  let l1 = 0, maxAbs = 0;
  for (let i = 0; i < N; i++) {
    const d = Math.abs(v[i] - ref[i]);
    l1 += d;
    if (d > maxAbs) maxAbs = d;
  }
  rows.push({
    K,
    grid: `${Math.round(Math.sqrt(K))}x${Math.round(Math.sqrt(K))}`,
    l1: l1 / N,
    maxAbs,
    anyShadowMeasure: p.anyShadowMeasure,
    fullShadowMeasure: p.fullShadowMeasure,
    segments: p.segments.length,
  });
}
const fit = rows.filter((r) => r.K !== 1024 && r.l1 > 0);
const xs = fit.map((r) => Math.log(r.K));
const ys = fit.map((r) => Math.log(r.l1));
const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
const my = ys.reduce((a, b) => a + b, 0) / ys.length;
const slope = xs.reduce((a, b, i) => a + (b - mx) * (ys[i] - my), 0) /
  xs.reduce((a, b) => a + (b - mx) ** 2, 0);
const out = {
  scene: scene.id,
  samples: N,
  referenceK: 1024,
  rows,
  logLogSlope: slope,
  note: 'L1/mean |coverage_K - coverage_1024| over t; each K profile is exact for its own K-point model.',
};
writeFileSync(new URL('./area-convergence.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
