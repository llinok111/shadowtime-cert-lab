# shadowtime-cert-lab

**Exact continuous-time shadow intervals for a moving receiver — 12 scenes / 660 triangles certified in 0.297 ms, 3.07× faster than 60 Hz frame sampling (0.913 ms), while the sampler structurally misses 1 of 4 sub-frame shadow events (shortest 2.61 ms).**

Per-frame shadow maps answer "is it shadowed *now*". This tool answers "**for which exact intervals** is it shadowed, and when does it enter/leave", with no time sampling. The receiver travels a straight path; every occluder's shadow volume is a convex trihedral cone cut by one plane, so each triangle contributes one affine interval, and the union is computed in closed form.

Upstream: none

## What it is

`src/core.mjs` (pure ES module, no imports, no DOM) computes, for a point light and a set of triangle occluders:

- `shadowCertificate(scene)` → merged shadow intervals `[lo,hi]` on `t ∈ [0,1]`, shadow/lit measure, longest sojourn, sub-frame event count, per-triangle attribution.
- `shadowedAt(scene, t)` → membership at one instant (same cone predicates).
- `timeScaleForBudget(scene, seconds)` → **minimal uniform speed-up** so no continuous shadow sojourn exceeds a frame budget; returns the exact ratio.
- `coverageProfile(scene, grid)` → exact piecewise-constant shadow coverage for a **K-point area-light model**, plus any-shadow / full-shadow intervals.

The browser page moves the receiver along the path, draws the exact union as a timeline, overlays 60 Hz frame ticks, and shows the live certificate numbers. The same `src/core.mjs` runs in node.

## Run it

```bash
node tools/gen-sample.mjs      # deterministic data/scenes.json (12 scenes, 660 tris)
node bench/verify.mjs          # behavioural assertions, exits 0
node bench/bench.mjs           # 15 samples + cold start -> bench/result.json

# visual layer (static server; three.js comes from a pinned CDN importmap)
python3 -m http.server 4173
# open http://localhost:4173
```

No install step, no bundler, no `node_modules`. Node ≥ 20.

## Evidence (all from `bench/result.json` and `bench/verify.mjs`)

| check | measured |
|---|---|
| exact certificate, 12 scenes | median **0.297 ms** (0.0248 ms/scene), p95 0.382 ms, 15 samples |
| 60 Hz baseline, same data (`baseline/sampled.mjs`) | median **0.913 ms** → **3.07×** slower than the exact certificate |
| cold start (first call, all scenes) | 6.02 ms (JIT warm-up, not steady state) |
| single-instant membership query | 10.36 µs/call |
| exact vs independent ray-cast oracle | **240,000** samples, **0** state mismatches, max measure diff 0.000083 |
| unseen random scenes (not in `data/`) | 40 scenes, 20,000 samples, **0** mismatches |
| 60 Hz misses | **1 of 4** sub-frame intervals (2.61 ms, 6.64 ms, 10.1 ms, 16.49 ms); sampled baseline sees none of that one |
| scale invariance 1e-6 … 1e6 | max interval-endpoint drift **6.1e-16**, measure drift 6.1e-16 |
| uniform repair | 11/11 scenes meet the 16.67 ms budget; exact speed 5.12×–11.74×; one step slower violates in 11/11 |
| K=16 area light | coverage profile matches 4,000 independent samples with **0** mismatches (exact for the K-point model) |

Reproduce each number with `node bench/verify.mjs` and `node bench/bench.mjs`. Timing noise is reported: certificate runs are sub-millisecond, so `relStddev` is 9.5% at 0.297 ms; the baseline is 5.2%.

## Why the exact interval is the point

Frame sampling at 60 Hz observes 60 instants. A 2.61 ms shadow event can sit entirely between two frames, so a renderer keeps the receiver lit for the whole pass. Here the event is an interval with exact endpoints; the timeline highlights it and the verifier proves the sampled baseline misses it. The exact route is also *faster* than 60 ray-cast passes because four affine clips per triangle replace 60 ray/triangle tests.

## 本轮创新

**B 档：把“阴影”从逐帧布尔值变成连续时间上的精确区间证书，并给出可执行的最短时间缩放。** Existing three.js shadow maps compute a boolean per rendered frame; `toi-cert-lab` computes triangle-pair TOI (not visibility); `labeltime-cert-lab` does 2D label rectangles. This is the first continuous-time shadow-volume certificate here: shadow-cone half-space clipping in `t`, sub-frame event detection, per-triangle attribution, and a minimal uniform time rescale that provably brings every shadow sojourn under a frame budget. The numbers are recomputable in node and shown live in the browser from the same core.

## Model and known limits

1. **Point light, hard shadows only.** The area-light path is exact for a finite K-point grid (K=16 here), not for a continuous rectangle; `coverageProfile` must not be read as an area-light ground truth.
2. **Measure-zero boundaries are not violations.** A path tangent to a shadow boundary contributes zero time measure. The certificate reports closed intervals; a single instant of tangency is not counted as a sojourn.
3. **One disclosed tolerance:** `LIGHT_PLANE_REL_EPS = 1e-9` treats triangles nearly edge-on to the light (signed light-plane height / (normal length × furthest vertex distance) < 1e-9) as zero-volume shadows and reports them as `degenerate` instead of guessing. The 12 sample scenes contain 0 degenerate triangles; the verifier constructs two and checks the refusal.
4. **Repair family is uniform time scaling**, not path offset or non-uniform retiming. The returned ratio is minimal among constant speeds ≥ 1×; it is not a globally optimal trajectory.
5. **Motion is linear** (`from → to`). Nonlinear receiver paths are not covered by the affine interval proof.
6. **Valid scale range:** all predicates are homogeneous, verified at 1e-6…1e6. Below ~1e-12 absolute units double-precision cancellation dominates and is untested.
7. The visual layer is syntax-checked and served statically; no browser automation or screenshot is used as evidence.

## Layout

```
index.html            importmap, pinned three@0.169.0
main.js               render + timeline + interaction only
src/core.mjs          interval engine (pure, no DOM, no imports)
src/oracle.mjs        independent Möller–Trumbore ray-cast oracle
baseline/sampled.mjs  naive 60 Hz frame sampler (the comparison baseline)
tools/gen-sample.mjs  deterministic scene generator
bench/verify.mjs      assertions with printed measured values
bench/bench.mjs       cold start + 15 samples -> bench/result.json
data/scenes.json      generated, 12 scenes / 660 triangles
```

MIT © 2026 llinok111