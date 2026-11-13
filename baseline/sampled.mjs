// Naive baseline: 60 Hz frame sampling of the same moving receiver.
// Deliberately independent of src/core.mjs and src/oracle.mjs.
// It answers only "was the receiver shadowed at the sampled instants";
// it cannot see what happens between frames.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function hit(o, d, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return false;
  const inv = 1 / det, tv = sub(o, a);
  const u = dot(tv, p) * inv;
  if (u < 0 || u > 1) return false;
  const q = cross(tv, e1), v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return false;
  const th = dot(e2, q) * inv;
  return th > 0 && th < 1;
}

export function shadowedByFrameSample(scene, t) {
  const p = scene.path;
  const x = [p.from[0] + (p.to[0] - p.from[0]) * t,
             p.from[1] + (p.to[1] - p.from[1]) * t,
             p.from[2] + (p.to[2] - p.from[2]) * t];
  const d = sub(scene.light, x);
  for (const tri of scene.triangles) if (hit(x, d, tri.a, tri.b, tri.c)) return true;
  return false;
}

export function sampleAtFps(scene, fps = 60) {
  const duration = scene.duration ?? 1;
  const n = Math.max(1, Math.round(duration * fps));
  const states = [];
  for (let i = 0; i < n; i++) states.push(shadowedByFrameSample(scene, (i + 0.5) / n));
  let hitCount = 0;
  for (const s of states) if (s) hitCount++;
  return {
    fps,
    samples: n,
    hitSamples: hitCount,
    measuredFraction: hitCount / n,
    states,
  };
}

export function missedSubFrameEvents(scene, intervals, fps = 60) {
  const sampled = sampleAtFps(scene, fps);
  const perFrame = 1 / fps;
  let missed = 0;
  const missedList = [];
  for (const iv of intervals) {
    if (iv.hi - iv.lo >= perFrame) continue;
    // Does any sampled instant land inside this sub-frame interval?
    let seen = false;
    for (let i = 0; i < sampled.samples; i++) {
      const t = (i + 0.5) / sampled.samples;
      if (t >= iv.lo && t <= iv.hi) { seen = true; break; }
    }
    if (!seen) { missed++; missedList.push({ lo: iv.lo, hi: iv.hi }); }
  }
  return { missed, missedList, sampled };
}