// Independent oracle. Deliberately different algorithm from src/core.mjs:
// dense ray casting (Möller-Trumbore) from receiver to light, instead of
// shadow-cone half-space clipping. It imports nothing from core and shares
// no constants with it; the only tolerance is the ray-parallel guard below.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Own guard, not imported from core (independent implementation).
function rayHitsTriangle(o, d, a, b, c) {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return false;
  const inv = 1 / det;
  const tv = sub(o, a);
  const u = dot(tv, p) * inv;
  if (u < 0 || u > 1) return false;
  const q = cross(tv, e1);
  const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return false;
  const tHit = dot(e2, q) * inv;
  return tHit > 0 && tHit < 1;
}

export function shadowedAt(scene, t, light = scene.light) {
  const X = lerp(scene.path.from, scene.path.to, t);
  const d = sub(light, X);
  for (const tri of scene.triangles) {
    if (rayHitsTriangle(X, d, tri.a, tri.b, tri.c)) return true;
  }
  return false;
}

/** Fraction of N midpoint samples that are shadowed. */
export function sampleShadowFraction(scene, N = 50000) {
  let hit = 0;
  for (let i = 0; i < N; i++) {
    if (shadowedAt(scene, (i + 0.5) / N)) hit++;
  }
  return hit / N;
}

export function statesAt(scene, N) {
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = shadowedAt(scene, (i + 0.5) / N) ? 1 : 0;
  return out;
}

/** Fraction shadowed for a K-point area light (independent of coverageProfile). */
export function sampleCoverage(scene, grid, N = 2000) {
  const { center, u, v, nx = 4, ny = 4 } = grid;
  const lights = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const su = (i + 0.5) / nx - 0.5;
      const sv = (j + 0.5) / ny - 0.5;
      lights.push([
        center[0] + u[0] * su + v[0] * sv,
        center[1] + u[1] * su + v[1] * sv,
        center[2] + u[2] * su + v[2] * sv,
      ]);
    }
  }
  const out = [];
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    let hit = 0;
    for (const L of lights) if (shadowedAt(scene, t, L)) hit++;
    out.push(hit / lights.length);
  }
  return out;
}