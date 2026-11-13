// Behavioural verification: every assertion prints its measured value.
import { readFileSync } from 'node:fs';
import {
  shadowCertificate, shadowIntervalForTriangle, shadowedAt,
  timeScaleForBudget, coverageProfile, coverageAt, scaleScene,
} from '../src/core.mjs';
import {
  shadowedAt as oracleShadowedAt, sampleShadowFraction,
  sampleCoverage,
} from '../src/oracle.mjs';
import { missedSubFrameEvents, sampleAtFps } from '../baseline/sampled.mjs';

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failures++;
}

const data = JSON.parse(readFileSync(new URL('../data/scenes.json', import.meta.url)));
const scenes = data.scenes;
console.log(`loaded ${scenes.length} scenes, ${scenes.reduce((n, s) => n + s.triangles.length, 0)} triangles`);

// 1. exact intervals vs independent ray-casting oracle, 20k samples per scene.
const N = 20000;
let totalSamples = 0;
let totalMismatch = 0;
let maxMeasureDiff = 0;
for (const s of scenes) {
  const cert = shadowCertificate(s);
  let mismatch = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const exact = cert.intervals.some((iv) => t >= iv.lo && t <= iv.hi);
    if (exact !== oracleShadowedAt(s, t)) mismatch++;
  }
  const frac = sampleShadowFraction(s, N);
  const diff = Math.abs(cert.shadowMeasure - frac);
  maxMeasureDiff = Math.max(maxMeasureDiff, diff);
  totalSamples += N;
  totalMismatch += mismatch;
  const ok = mismatch === 0 && diff <= 0.002;
  check(`oracle/${s.id}`, ok, `samples=${N} mismatch=${mismatch} exact=${cert.shadowMeasure.toFixed(6)} oracle=${frac.toFixed(6)} |diff|=${diff.toFixed(6)}`);
}
check('oracle/total', totalMismatch === 0 && totalSamples === scenes.length * N,
  `samples=${totalSamples} mismatch=${totalMismatch} maxMeasureDiff=${maxMeasureDiff.toFixed(6)}`);

// 2. sub-frame events: exact sees them, 60 Hz frame sampling does not.
let subTotal = 0;
let missedTotal = 0;
for (const s of scenes) {
  const cert = shadowCertificate(s);
  const r = missedSubFrameEvents(s, cert.intervals, 60);
  subTotal += cert.subFrameCount;
  missedTotal += r.missed;
  if (cert.subFrameCount) {
    console.log(`  ${s.id}: subFrame=${cert.subFrameCount} missedBy60Hz=${r.missed} shortestMs=${(Math.min(...cert.intervals.map(iv => iv.hi - iv.lo)) * 1000).toFixed(3)}`);
  }
}
check('subframe/detected-by-exact', subTotal >= 4, `subFrameIntervals=${subTotal}`);
check('subframe/missed-by-60Hz', missedTotal >= 1, `missed=${missedTotal}/${subTotal}`);

// 3. scale invariance: 1e-6 ... 1e6, interval endpoints and measure unchanged.
const scales = [1e-6, 1e-3, 1, 1e3, 1e6];
let maxEndpointDrift = 0;
let maxMeasureDrift = 0;
for (const s of scenes) {
  const base = shadowCertificate(s);
  for (const k of scales) {
    const scaled = shadowCertificate(scaleScene(s, k));
    const drift = Math.max(
      Math.abs(scaled.shadowMeasure - base.shadowMeasure),
      scaled.intervals.length === base.intervals.length
        ? Math.max(0, ...scaled.intervals.map((iv, i) => Math.max(
            Math.abs(iv.lo - base.intervals[i].lo), Math.abs(iv.hi - base.intervals[i].hi))))
        : Infinity,
    );
    maxEndpointDrift = Math.max(maxEndpointDrift, drift);
    maxMeasureDrift = Math.max(maxMeasureDrift, Math.abs(scaled.shadowMeasure - base.shadowMeasure));
    if (scaled.intervalCount !== base.intervalCount) maxEndpointDrift = Infinity;
  }
}
check('scale/interval-endpoints', maxEndpointDrift <= 1e-9, `scales=${scales.length} maxEndpointDrift=${maxEndpointDrift.toExponential(3)}`);
check('scale/measure', maxMeasureDrift <= 1e-9, `maxMeasureDrift=${maxMeasureDrift.toExponential(3)}`);

// 4. uniform time rescaling: minimal speed, budget met, one step slower fails.
const target = 1 / 60;
const repairScenes = scenes.filter((s) => shadowCertificate(s).maxIntervalSeconds > target);
let repairOk = 0;
let maxAfter = 0;
let minSlowViolation = 0;
for (const s of repairScenes) {
  const cert = shadowCertificate(s);
  const r = timeScaleForBudget(s, target);
  const after = cert.maxIntervalSeconds / r.appliedSpeed;
  maxAfter = Math.max(maxAfter, after);
  const slower = timeScaleForBudget(s, target * (r.appliedSpeed / (r.appliedSpeed - 1e-6)));
  const slowAfter = cert.maxIntervalSeconds / (r.appliedSpeed * (1 - 1e-6));
  if (slowAfter > target) minSlowViolation++;
  if (after <= target + 1e-12 && r.feasible) repairOk++;
}
check('repair/budget', repairOk === repairScenes.length,
  `scenes=${repairScenes.length} met=${repairOk} maxAfterSeconds=${maxAfter.toFixed(9)} target=${target.toFixed(9)}`);
check('repair/minimality', minSlowViolation === repairScenes.length,
  `oneStepSlowerViolates=${minSlowViolation}/${repairScenes.length}`);

// 5. degenerate inputs are refused, never guessed.
const light = [0, 5, 0];
const coplanar = { a: [-1, 5, -1], b: [1, 5, -1], c: [0, 5, 1] };
const zeroArea = { a: [0, 3, 0], b: [1, 3, 0], c: [2, 3, 0] };
const r1 = shadowIntervalForTriangle(coplanar, light, [-2, 1, 0], [2, 1, 0], 'coplanar');
const r2 = shadowIntervalForTriangle(zeroArea, light, [-2, 1, 0], [2, 1, 0], 'zero');
check('degenerate/light-in-plane', r1.status === 'degenerate' && r1.reason === 'light-in-triangle-plane', `${r1.status}/${r1.reason}`);
check('degenerate/zero-area', r2.status === 'degenerate' && r2.reason === 'zero-area-triangle', `${r2.status}/${r2.reason}`);

// 6. area-light coverage profile is exact for the K-point model.
const areaScene = scenes.find((s) => s.lightGrid);
const profile = coverageProfile(areaScene, areaScene.lightGrid);
const sampled = sampleCoverage(areaScene, areaScene.lightGrid, 4000);
let covMismatch = 0;
let maxCovDiff = 0;
for (let i = 0; i < sampled.length; i++) {
  const t = (i + 0.5) / sampled.length;
  const got = coverageAt(profile, t);
  maxCovDiff = Math.max(maxCovDiff, Math.abs(got - sampled[i]));
  if (Math.abs(got - sampled[i]) > 1e-12) covMismatch++;
}
check('area/coverage-model', covMismatch === 0 && profile.K === 16,
  `K=${profile.K} samples=${sampled.length} mismatch=${covMismatch} maxDiff=${maxCovDiff.toExponential(3)}`);
check('area/interval-measures', profile.anyShadowMeasure > 0 && profile.fullShadowMeasure > 0 && profile.partialMeasure >= 0,
  `any=${profile.anyShadowMeasure.toFixed(4)} full=${profile.fullShadowMeasure.toFixed(4)} partial=${profile.partialMeasure.toFixed(4)}`);

// 7. random non-built-in scenes: independent oracle over 40 cases.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}
let randomMismatch = 0;
let randomShadowed = 0;
let randomSamples = 0;
for (let k = 0; k < 40; k++) {
  const r = rng(1000 + k);
  const rand = () => [r() * 6 - 3, r() * 4 + 1.2, r() * 2 - 1];
  const scene = {
    id: `random-${k}`,
    light: [r() * 2 - 1, 5 + r(), r() * 2 - 1],
    path: { from: [-3 + r(), 1, -1 + r()], to: [3 - r(), 1, -1 + r()] },
    triangles: Array.from({ length: 6 }, () => ({ a: rand(), b: rand(), c: rand() })),
  };
  const cert = shadowCertificate(scene);
  for (let i = 0; i < 500; i++) {
    const t = (i + 0.5) / 500;
    const exact = cert.intervals.some((iv) => t >= iv.lo && t <= iv.hi);
    const oracle = oracleShadowedAt(scene, t);
    if (exact !== oracle) randomMismatch++;
    if (oracle) randomShadowed++;
    randomSamples++;
  }
}
check('random/unseen-scenes', randomMismatch === 0,
  `scenes=40 samples=${randomSamples} mismatch=${randomMismatch} shadowedSamples=${randomShadowed}`);

// 8. sampled baseline itself is not accidentally exact on sub-frame events.
const baselineStates = sampleAtFps(scenes.find((s) => s.id === 'three-needles'), 60);
check('baseline/60Hz-count', baselineStates.samples === 60, `samples=${baselineStates.samples} hit=${baselineStates.hitSamples}`);

console.log(`\nRESULT ${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);