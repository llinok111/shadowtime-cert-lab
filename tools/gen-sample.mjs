// Deterministic scene generator. Fixed seed => byte-identical data/scenes.json.
import { writeFileSync, mkdirSync } from 'node:fs';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 12 triangles of an axis-aligned box, each with an id "<box>/<face><n>".
function box(id, cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], // -z
    [4, 6, 5], [4, 7, 6], // +z
    [0, 4, 5], [0, 5, 1], // -y
    [3, 2, 6], [3, 6, 7], // +y
    [0, 3, 7], [0, 7, 4], // -x
    [1, 5, 6], [1, 6, 2], // +x
  ];
  return faces.map((f, k) => ({
    id: `${id}/f${k}`,
    a: v[f[0]], b: v[f[1]], c: v[f[2]],
  }));
}

function scene(id, build) {
  const triangles = [];
  let boxIndex = 0;
  const addBox = (cx, cy, cz, sx, sy, sz) => {
    triangles.push(...box(`${id}-b${boxIndex++}`, cx, cy, cz, sx, sy, sz));
  };
  const s = build({ addBox });
  return {
    id,
    duration: 1,
    light: [0, 5, 0],
    path: s.path,
    triangles,
    ...(s.lightGrid ? { lightGrid: s.lightGrid } : {}),
  };
}

const scenes = [];

// 1. evenly spaced gate: several shadows, one 0.02-wide thin post.
scenes.push(scene('gate-thin', ({ addBox }) => {
  for (let i = 0; i < 6; i++) {
    const cx = -3 + i * 2;
    if (i === 0) { addBox(-6.9, 1.18, 0, 0.01, 0.08, 0.5); continue; }
    const w = 0.55;
    addBox(cx, 1.62, 0, w, 0.55, 0.75);
  }
  return { path: { from: [-8, 1, 0], to: [8, 1, 0] } };
}));

// 2. dense comb with 8 posts, two of them sub-frame thin.
scenes.push(scene('comb-dense', ({ addBox }) => {
  for (let i = 0; i < 8; i++) {
    const cx = -6.3 + i * 1.8;
    const w = i === 2 || i === 6 ? 0.025 : 0.45;
    addBox(cx, 1.58 + (i % 2) * 0.12, 0, w, 0.5, 0.7);
  }
  return { path: { from: [-8, 1, 0], to: [8, 1, 0] } };
}));

// 3. slalom: receiver changes height, boxes at varying heights.
scenes.push(scene('slalom-height', ({ addBox }) => {
  addBox(-4, 1.65, 0, 0.45, 0.6, 0.7);
  addBox(-1, 1.60, 0, 0.55, 0.55, 0.8);
  addBox(2, 1.70, 0, 0.28, 0.5, 0.6);
  addBox(5, 1.62, 0, 0.5, 0.6, 0.7);
  return { path: { from: [-7, 0.8, 0], to: [7, 1.4, 0] } };
}));

// 4. offset path in z; boxes still intersect the moving ray.
scenes.push(scene('offset-z', ({ addBox }) => {
  addBox(-3.5, 1.65, 0.2, 0.4, 0.6, 0.8);
  addBox(0.5, 1.60, -0.2, 0.35, 0.55, 0.7);
  addBox(4, 1.68, 0.1, 0.45, 0.6, 0.8);
  return { path: { from: [-7, 1, -0.3], to: [7, 1, 0.3] } };
}));

// 5. far field: no occluder intersects the receiver-light rays.
scenes.push(scene('no-shadow', ({ addBox }) => {
  addBox(-20, 1.6, 0, 1, 0.6, 1);
  addBox(20, 1.6, 0, 1, 0.6, 1);
  addBox(0, 1.6, 20, 1, 0.6, 1);
  return { path: { from: [-8, 1, 0], to: [8, 1, 0] } };
}));

// 6-9. seeded random combs.
for (let k = 0; k < 4; k++) {
  const rnd = mulberry32(100 + k);
  scenes.push(scene(`random-${k}`, ({ addBox }) => {
    const n = 4 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const cx = -6.5 + (13 * (i + 0.5)) / n + (rnd() - 0.5) * 0.8;
      const thin = rnd() < 0.35;
      addBox(cx, 1.55 + rnd() * 0.25, (rnd() - 0.5) * 0.4,
        thin ? 0.012 + rnd() * 0.012 : 0.18 + rnd() * 0.3,
        0.4 + rnd() * 0.35, 0.5 + rnd() * 0.4);
    }
    return { path: { from: [-8, 1, 0], to: [8, 1, 0] } };
  }));
}

// 10. very short path: only a couple of shadows, tests duration scaling.
scenes.push(scene('short-path', ({ addBox }) => {
  addBox(-0.9, 1.6, 0, 0.35, 0.55, 0.7);
  addBox(0.2, 1.62, 0, 0.012, 0.5, 0.6);
  addBox(0.9, 1.6, 0, 0.35, 0.55, 0.7);
  return { path: { from: [-1.5, 1, 0], to: [1.5, 1, 0] } };
}));

// 11. three thin posts: sub-frame events from a different arrangement.
scenes.push(scene('three-needles', ({ addBox }) => {
  addBox(-6.45, 1.63, 0, 0.02, 0.5, 0.7);
  addBox(0.1, 1.60, 0, 0.02, 0.52, 0.7);
  addBox(2.7, 1.64, 0, 0.016, 0.5, 0.65);
  addBox(5.5, 1.62, 0, 0.4, 0.55, 0.7);
  return { path: { from: [-8, 1, 0], to: [8, 1, 0] } };
}));

// 12. area-light scene: 4x4 samples in the x-z plane above the boxes.
scenes.push(scene('area-grid', ({ addBox }) => {
  addBox(-3.2, 1.65, 0, 0.4, 0.6, 0.9);
  addBox(0.4, 1.60, 0.2, 0.5, 0.55, 1.0);
  addBox(3.6, 1.68, -0.2, 0.38, 0.6, 0.9);
  return {
    path: { from: [-7, 1, 0], to: [7, 1, 0] },
    lightGrid: { center: [0, 5, 0], u: [1.2, 0, 0], v: [0, 0, 1.2], nx: 4, ny: 4 },
  };
}));

const out = {
  generator: 'tools/gen-sample.mjs',
  seed: 'mulberry32(100..103), fixed layouts',
  scenes,
};
mkdirSync('data', { recursive: true });
const text = JSON.stringify(out, null, 1) + '\n';
writeFileSync('data/scenes.json', text);
const bytes = Buffer.byteLength(text);
console.log(`wrote data/scenes.json: ${scenes.length} scenes, ${scenes.reduce((n, s) => n + s.triangles.length, 0)} triangles, ${bytes} bytes`);