// Pure geometry/interval math for continuous-time hard shadows.
// No browser globals, no imports, no I/O. Every function is deterministic.
//
// Model: a point receiver travels P(t) = from + t*(to-from), t in [0,1].
// A point light at L and a triangle (a,b,c) cast a convex shadow volume:
//   * the trihedral cone with apex L spanned by a-L, b-L, c-L (3 linear half-spaces)
//   * the "beyond the triangle plane" half-space (1 linear inequality)
// Each inequality is affine in t, so the shadowed set of one triangle along the
// path is one closed interval. Clipping four affine inequalities is exact
// (no sampling, no per-frame steps).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => Math.sqrt(dot(a, a));
const lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Disclosed relative threshold: a triangle whose plane is within this
// relative signed height of the light is treated as edge-on (zero-volume
// shadow). This is the only tolerance in the interval engine.
export const LIGHT_PLANE_REL_EPS = 1e-9;

// Clip [lo,hi] against s*(a + b*t) >= 0. Mutates the pair via return value.
function clipAffine(a, b, s, lo, hi) {
  if (b === 0) {
    return s * a >= 0 ? [lo, hi] : null;
  }
  const root = -a / b;
  if (s * b > 0) {
    if (root > lo) lo = root;
  } else if (root < hi) {
    hi = root;
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Exact shadowed t-interval of one triangle for a linearly moving receiver.
 * Returns {status:'active', lo, hi, id} | {status:'empty', id} |
 *         {status:'degenerate', id, reason}.
 */
export function shadowIntervalForTriangle(tri, light, p0, p1, id = tri.id ?? null) {
  const A = tri.a ?? tri[0];
  const B = tri.b ?? tri[1];
  const C = tri.c ?? tri[2];
  const n = cross(sub(B, A), sub(C, A));
  const nn = norm(n);
  if (!(nn > 0)) return { status: 'degenerate', id, reason: 'zero-area-triangle' };

  const la = sub(A, light);
  const lb = sub(B, light);
  const lc = sub(C, light);
  const h = dot(n, la);
  const reach = Math.max(norm(la), norm(lb), norm(lc));
  if (reach === 0) return { status: 'degenerate', id, reason: 'light-on-vertex' };
  if (Math.abs(h) / (nn * reach) < LIGHT_PLANE_REL_EPS) {
    return { status: 'degenerate', id, reason: 'light-in-triangle-plane' };
  }

  const v = sub(p1, p0);
  let lo = 0;
  let hi = 1;

  const edges = [
    [A, B, C],
    [B, C, A],
    [C, A, B],
  ];
  for (const [U, V, W] of edges) {
    const m = cross(sub(U, light), sub(V, light));
    const mn = norm(m);
    if (!(mn > 0)) return { status: 'degenerate', id, reason: 'light-on-edge' };
    const s = Math.sign(dot(m, sub(W, light)));
    if (s === 0) return { status: 'degenerate', id, reason: 'light-in-edge-plane' };
    const a = dot(m, sub(p0, light));
    const b = dot(m, v);
    const clipped = clipAffine(a, b, s, lo, hi);
    if (!clipped) return { status: 'empty', id };
    [lo, hi] = clipped;
  }

  // Beyond the triangle plane: X = L + lambda*(Q-L), lambda >= 1.
  const s2 = Math.sign(h);
  const a2 = dot(n, sub(p0, light)) - h;
  const b2 = dot(n, v);
  const clipped = clipAffine(a2, b2, s2, lo, hi);
  if (!clipped) return { status: 'empty', id };
  [lo, hi] = clipped;

  if (lo < 0) lo = 0;
  if (hi > 1) hi = 1;
  if (lo > hi) return { status: 'empty', id };
  return { status: 'active', id, lo, hi };
}

/** Intersect and sort per-triangle active intervals; report degenerates. */
export function triangleIntervals(scene) {
  const { light, path, triangles } = scene;
  const active = [];
  const degenerate = [];
  for (const tri of triangles) {
    const iv = shadowIntervalForTriangle(tri, light, path.from, path.to, tri.id);
    if (iv.status === 'active') active.push(iv);
    else if (iv.status === 'degenerate') degenerate.push(iv);
  }
  active.sort((x, y) => x.lo - y.lo || x.hi - y.hi);
  return { active, degenerate };
}

function mergeIntervals(active) {
  const merged = [];
  for (const iv of active) {
    const last = merged[merged.length - 1];
    if (last && iv.lo <= last.hi) {
      if (iv.hi > last.hi) last.hi = iv.hi;
      last.ids.push(iv.id);
      if (last.contributors !== undefined) last.contributors++;
    } else {
      merged.push({ lo: iv.lo, hi: iv.hi, ids: [iv.id] });
    }
  }
  return merged;
}

/**
 * Continuous-time shadow certificate.
 * Exact union of all triangle shadow intervals along the path.
 */
export function shadowCertificate(scene, opts = {}) {
  const duration = scene.duration ?? 1;
  const fps = opts.fps ?? 60;
  const { active, degenerate } = triangleIntervals(scene);
  const merged = mergeIntervals(active);
  let shadowMeasure = 0;
  let maxInterval = 0;
  for (const iv of merged) {
    const len = iv.hi - iv.lo;
    shadowMeasure += len;
    if (len > maxInterval) maxInterval = len;
  }
  const reasons = {};
  for (const d of degenerate) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  const subFrame = merged
    .map((iv) => ({ lo: iv.lo, hi: iv.hi, seconds: (iv.hi - iv.lo) * duration }))
    .filter((iv) => iv.seconds < 1 / fps);
  return {
    scene: scene.id ?? null,
    duration,
    fps,
    triangles: scene.triangles.length,
    activeTriangles: active.length,
    degenerateTriangles: degenerate.length,
    degenerateReasons: reasons,
    rawIntervalCount: active.length,
    intervalCount: merged.length,
    intervals: merged,
    shadowMeasure,
    litMeasure: 1 - shadowMeasure,
    maxInterval,
    maxIntervalSeconds: maxInterval * duration,
    subFrameIntervals: subFrame,
    subFrameCount: subFrame.length,
  };
}

/** Shadow membership at one parameter value, evaluated from the same cone predicates. */
export function shadowedAt(scene, t) {
  const X = lerp(scene.path.from, scene.path.to, t);
  for (const tri of scene.triangles) {
    const A = tri.a ?? tri[0];
    const B = tri.b ?? tri[1];
    const C = tri.c ?? tri[2];
    const n = cross(sub(B, A), sub(C, A));
    const nn = norm(n);
    if (!(nn > 0)) continue;
    const h = dot(n, sub(A, scene.light));
    const reach = Math.max(
      norm(sub(A, scene.light)),
      norm(sub(B, scene.light)),
      norm(sub(C, scene.light)),
    );
    if (reach === 0 || Math.abs(h) / (nn * reach) < LIGHT_PLANE_REL_EPS) continue;
    const d = sub(X, scene.light);
    let ok = true;
    for (const [U, V, W] of [[A, B, C], [B, C, A], [C, A, B]]) {
      const m = cross(sub(U, scene.light), sub(V, scene.light));
      const s = Math.sign(dot(m, sub(W, scene.light)));
      if (s === 0 || s * dot(m, d) < 0) { ok = false; break; }
    }
    if (!ok) continue;
    const s2 = Math.sign(h);
    if (s2 * (dot(n, d) - h) < 0) continue;
    return true;
  }
  return false;
}

/** Uniform time rescaling: minimal speed >= 1 so no shadow interval exceeds maxSeconds. */
export function timeScaleForBudget(scene, maxSeconds) {
  const cert = shadowCertificate(scene);
  const duration = scene.duration ?? 1;
  if (maxSeconds <= 0) {
    return {
      feasible: cert.shadowMeasure === 0,
      requiredMinimum: cert.shadowMeasure === 0 ? 1 : Infinity,
      appliedSpeed: cert.shadowMeasure === 0 ? 1 : Infinity,
      beforeMaxSeconds: cert.maxIntervalSeconds,
      afterMaxSeconds: cert.shadowMeasure === 0 ? 0 : Infinity,
      reason: cert.shadowMeasure === 0 ? 'no-shadow' : 'positive-shadow-measure',
    };
  }
  const ratio = cert.maxIntervalSeconds / maxSeconds;
  const appliedSpeed = Math.max(1, ratio);
  return {
    feasible: true,
    requiredMinimum: ratio,
    appliedSpeed,
    beforeMaxSeconds: cert.maxIntervalSeconds,
    afterMaxSeconds: cert.maxIntervalSeconds / appliedSpeed,
    reason: ratio > 1 ? 'speedup-required' : 'already-within-budget',
  };
}

// ---------- area light sampled on a rectangle (exact for the K-point model) ----------

export function lightSamples(grid) {
  const { center, u, v, nx = 4, ny = 4 } = grid;
  const pts = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const su = (i + 0.5) / nx - 0.5;
      const sv = (j + 0.5) / ny - 0.5;
      pts.push(add(center, add(mul(u, su), mul(v, sv))));
    }
  }
  return pts;
}

/**
 * Exact piecewise-constant shadow coverage for a K-point area light.
 * For each light sample, union its shadow intervals, then sweep all samples.
 * coverage(t) = (# samples whose shadow union contains t) / K.
 */
export function coverageProfile(scene, grid) {
  const samples = lightSamples(grid);
  const K = samples.length;
  const events = [];
  for (const L of samples) {
    const { active } = triangleIntervals({ ...scene, light: L });
    const merged = mergeIntervals(active);
    for (const iv of merged) {
      if (iv.hi <= iv.lo) continue;
      events.push({ t: iv.lo, d: 1 });
      events.push({ t: iv.hi, d: -1 });
    }
  }
  events.sort((a, b) => a.t - b.t || a.d - b.d);
  const segments = [];
  let count = 0;
  let prev = 0;
  let idx = 0;
  while (idx < events.length) {
    const t = events[idx].t;
    if (t > prev) {
      if (segments.length && segments[segments.length - 1].count === count) {
        segments[segments.length - 1].hi = t;
      } else if (t > prev) {
        segments.push({ lo: prev, hi: t, count });
      }
    }
    while (idx < events.length && events[idx].t === t) {
      count += events[idx].d;
      idx++;
    }
    prev = t;
  }
  if (prev < 1) {
    if (segments.length && segments[segments.length - 1].count === count) {
      segments[segments.length - 1].hi = 1;
    } else {
      segments.push({ lo: prev, hi: 1, count });
    }
  }
  for (const s of segments) {
    s.fraction = s.count / K;
    s.seconds = (s.hi - s.lo) * (scene.duration ?? 1);
  }
  const anyShadow = segments.filter((s) => s.count > 0);
  const fullShadow = segments.filter((s) => s.count === K);
  const anyShadowMeasure = sumLength(anyShadow);
  return {
    K,
    segments,
    anyShadow,
    fullShadow,
    anyShadowMeasure,
    fullShadowMeasure: sumLength(fullShadow),
    partialMeasure: sumLength(segments.filter((s) => s.count > 0 && s.count < K)),
    maxFraction: segments.reduce((m, s) => Math.max(m, s.fraction), 0),
  };
}

function sumLength(xs) {
  let m = 0;
  for (const x of xs) m += x.hi - x.lo;
  return m;
}

/** Coverage from the exact profile at t (boundary chosen to the right segment). */
export function coverageAt(profile, t) {
  for (const s of profile.segments) {
    if (t >= s.lo && t <= s.hi) return s.fraction;
  }
  return 0;
}

/** Scale a whole scene about the origin; used for scale-invariance tests. */
export function scaleScene(scene, s) {
  const p = (q) => [q[0] * s, q[1] * s, q[2] * s];
  const grid = scene.lightGrid
    ? {
        ...scene.lightGrid,
        center: p(scene.lightGrid.center),
        u: mul(scene.lightGrid.u, s),
        v: mul(scene.lightGrid.v, s),
      }
    : undefined;
  return {
    ...scene,
    light: p(scene.light),
    path: { from: p(scene.path.from), to: p(scene.path.to) },
    triangles: scene.triangles.map((tri) => ({
      id: tri.id,
      a: p(tri.a),
      b: p(tri.b),
      c: p(tri.c),
    })),
    lightGrid: grid,
  };
}