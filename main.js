import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { shadowCertificate, timeScaleForBudget, shadowedAt } from './src/core.mjs';

const data = await (await fetch('./data/scenes.json')).json();
const scenes = data.scenes;

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
scene.fog = new THREE.FogExp2(0x05070c, 0.028);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(9, 6.5, 12);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.2, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x0a1020, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(4, 9, 6);
scene.add(key);

const grid = new THREE.GridHelper(24, 24, 0x1b3355, 0x122238);
grid.position.y = -0.01;
scene.add(grid);

const world = new THREE.Group();
scene.add(world);

let current = null;
let cert = null;
let repair = null;
let playing = true;
let speed = 1;
let t = 0;
let last = performance.now();
let receiver = null;
let lamp = null;
let pathLine = null;

function trianglesGeometry(tris) {
  const pos = new Float32Array(tris.length * 9);
  let o = 0;
  for (const tri of tris) {
    for (const p of [tri.a, tri.b, tri.c]) {
      pos[o++] = p[0]; pos[o++] = p[1]; pos[o++] = p[2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function build(index) {
  current = scenes[index];
  cert = shadowCertificate(current);
  repair = timeScaleForBudget(current, 1 / 60);
  while (world.children.length) {
    const c = world.children.pop();
    c.geometry?.dispose();
    c.material?.dispose();
  }

  const geo = trianglesGeometry(current.triangles);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9db8e8, metalness: 0.25, roughness: 0.45,
    transparent: true, opacity: 0.34, side: THREE.DoubleSide,
    emissive: 0x0a1830, emissiveIntensity: 0.8,
  });
  const occluders = new THREE.Mesh(geo, mat);
  world.add(occluders);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 18),
    new THREE.LineBasicMaterial({ color: 0x4f79b8, transparent: true, opacity: 0.25 }),
  );
  world.add(edges);

  lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff2c4 }),
  );
  lamp.position.fromArray(current.light);
  world.add(lamp);
  const halo = new THREE.PointLight(0xfff0c0, 18, 22, 1.6);
  halo.position.fromArray(current.light);
  world.add(halo);

  receiver = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffb020, emissiveIntensity: 2.2 }),
  );
  world.add(receiver);

  const pts = [current.path.from, current.path.to].map((p) => new THREE.Vector3(...p));
  pathLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: 0x6d8fc4, dashSize: 0.25, gapSize: 0.18 }),
  );
  pathLine.computeLineDistances();
  world.add(pathLine);

  t = 0;
  document.getElementById('iv').textContent = `${cert.intervalCount} (${cert.rawIntervalCount} raw)`;
  document.getElementById('measure').textContent = `${(cert.shadowMeasure * 100).toFixed(2)}% of path`;
  document.getElementById('maxiv').textContent = `${(cert.maxIntervalSeconds * 1000).toFixed(2)} ms`;
  document.getElementById('repair').textContent = repair.feasible
    ? `${repair.appliedSpeed.toFixed(2)}×` : 'infeasible';
  document.getElementById('miss').textContent =
    `${cert.subFrameCount} sub-frame · 60Hz sees ${sampleHits(cert)}`;
  drawTimeline();
}

// Count how many of the 60 frame instants land in a sub-frame interval.
function sampleHits(c) {
  let hits = 0;
  for (let i = 0; i < 60; i++) {
    const tt = (i + 0.5) / 60;
    if (c.intervals.some((iv) => tt >= iv.lo && tt <= iv.hi && iv.hi - iv.lo < 1 / 60)) hits++;
  }
  return hits;
}

function drawTimeline() {
  const cv = document.getElementById('tl');
  const dpr = Math.min(devicePixelRatio, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const pad = 18, top = 18, barH = 24, gap = 10;
  const W = w - pad * 2;
  const x = (v) => pad + v * W;

  ctx.fillStyle = '#7f95b8';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('exact continuous union', pad, top - 5);
  ctx.fillStyle = '#0c1626';
  ctx.fillRect(pad, top, W, barH);
  for (const iv of cert.intervals) {
    ctx.fillStyle = iv.hi - iv.lo < 1 / 60 ? '#ff9f43' : '#3f6fb8';
    ctx.fillRect(x(iv.lo), top, Math.max(1.5, (iv.hi - iv.lo) * W), barH);
  }

  const y2 = top + barH + gap;
  ctx.fillStyle = '#7f95b8';
  ctx.fillText('60 Hz frame samples   (orange tick = frame inside a sub-frame event)', pad, y2 - 5);
  ctx.fillStyle = '#0c1626';
  ctx.fillRect(pad, y2, W, barH);
  for (let i = 0; i < 60; i++) {
    const tt = (i + 0.5) / 60;
    const hit = shadowedAt(current, tt);
    const fx = x(tt);
    ctx.fillStyle = hit ? '#ffd166' : '#22344f';
    ctx.fillRect(fx - 1, y2 + 4, 2, barH - 8);
    const sub = cert.intervals.some((iv) => tt >= iv.lo && tt <= iv.hi && iv.hi - iv.lo < 1 / 60);
    if (sub) {
      ctx.fillStyle = '#ff9f43';
      ctx.fillRect(fx - 2.5, y2 + 1, 5, barH - 2);
    }
  }

  ctx.fillStyle = '#ff9f43';
  const cursorX = x(t);
  ctx.fillRect(cursorX - 1, top - 2, 2, barH + gap + barH + 4);
  ctx.fillStyle = '#dbe7ff';
  ctx.fillText(`t=${t.toFixed(3)}`, Math.min(w - 52, Math.max(pad, cursorX - 18)), h - 4);
}

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (playing) t = (t + dt * speed) % 1;

  const p = current.path;
  receiver.position.set(
    p.from[0] + (p.to[0] - p.from[0]) * t,
    p.from[1] + (p.to[1] - p.from[1]) * t,
    p.from[2] + (p.to[2] - p.from[2]) * t,
  );
  const hit = shadowedAt(current, t);
  receiver.material.color.setHex(hit ? 0xff6b6b : 0xffe08a);
  receiver.material.emissive.setHex(hit ? 0x7a1f1f : 0xffb020);
  document.getElementById('t').textContent = t.toFixed(3);
  const st = document.getElementById('state');
  st.textContent = hit ? 'in shadow' : 'lit';
  st.className = hit ? 'warn' : 'ok';

  drawTimeline();
  controls.update();
  renderer.render(scene, camera);
}

document.getElementById('scene').innerHTML = scenes
  .map((s, i) => `<option value="${i}">${s.id} · ${s.triangles.length} tris</option>`)
  .join('');
document.getElementById('scene').addEventListener('change', (e) => build(Number(e.target.value)));
document.getElementById('speed').addEventListener('input', (e) => {
  speed = Number(e.target.value);
  document.getElementById('speedv').textContent = `${speed.toFixed(2)}×`;
});
document.getElementById('play').addEventListener('click', (e) => {
  playing = !playing;
  e.target.textContent = playing ? 'pause' : 'play';
});
document.getElementById('reset').addEventListener('click', () => { t = 0; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

build(0);
requestAnimationFrame(tick);