/**
 * Loop continuity of every shipped locomotion clip, read straight out of the GLB.
 *
 * Three questions, one per hypothesis:
 *  1. does every channel run to the clip's own duration, or do some end early and hold?
 *  2. does the pose at t=duration equal the pose at t=0 — the wrap LoopRepeat performs?
 *  3. how big is the hips' vertical step at that wrap, which is the one the root lock leaves live?
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { readGlb, sanitizeNodeName, ROOT, ANIMATIONS_DIR } from './animation-manifest.mjs';

function accessor(json, bin, index) {
  const a = json.accessors[index];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const view = json.bufferViews[a.bufferView];
  const stride = view.byteStride ?? size * 4;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const at = base + i * stride;
    const v = [];
    for (let c = 0; c < size; c++) v.push(bin.readFloatLE(at + c * 4));
    out.push(v);
  }
  return out;
}

function quatAngleDeg(a, b) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  dot = Math.min(1, Math.abs(dot));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}

function report(file) {
  const { json, bin } = readGlb(file, { bin: true });
  const nodeName = (i) => sanitizeNodeName(json.nodes[i]?.name ?? `node${i}`);
  const rows = [];
  for (const animation of json.animations ?? []) {
    let duration = 0;
    for (const ch of animation.channels) {
      const max = json.accessors[animation.samplers[ch.sampler].input]?.max?.[0];
      if (typeof max === 'number') duration = Math.max(duration, max);
    }
    let shortTracks = 0;
    let worstRot = { deg: 0, bone: '' };
    let worstPos = { cm: 0, bone: '', axis: '' };
    let hipsY = null;
    let firstTime = Infinity;
    for (const ch of animation.channels) {
      const sampler = animation.samplers[ch.sampler];
      const times = accessor(json, bin, sampler.input).map((t) => t[0]);
      const values = accessor(json, bin, sampler.output);
      const bone = nodeName(ch.target.node);
      const t0 = times[0];
      const t1 = times[times.length - 1];
      firstTime = Math.min(firstTime, t0);
      if (t1 < duration - 1e-4) shortTracks++;
      const first = values[0];
      const last = values[values.length - 1];
      if (ch.target.path === 'rotation') {
        const deg = quatAngleDeg(first, last);
        if (deg > worstRot.deg) worstRot = { deg, bone };
      } else if (ch.target.path === 'translation') {
        for (let axis = 0; axis < 3; axis++) {
          const cm = Math.abs(last[axis] - first[axis]) * 100;
          if (cm > worstPos.cm) worstPos = { cm, bone, axis: 'xyz'[axis] };
        }
        if (bone === 'mixamorigHips') {
          hipsY = {
            x: (last[0] - first[0]) * 100,
            y: (last[1] - first[1]) * 100,
            z: (last[2] - first[2]) * 100,
            vFirst: first[2],
            vLast: last[2],
            vMin: Math.min(...values.map((v) => v[2])),
            vMax: Math.max(...values.map((v) => v[2])),
          };
        }
      }
    }
    rows.push({
      file: path.relative(path.join(ROOT, ANIMATIONS_DIR), file).split(path.sep).join('/'),
      clip: animation.name,
      duration: +duration.toFixed(3),
      firstTime: +firstTime.toFixed(3),
      channels: animation.channels.length,
      shortTracks,
      worstRotDeg: +worstRot.deg.toFixed(2),
      worstRotBone: worstRot.bone,
      hipsWrapCm: hipsY,
    });
  }
  return rows;
}

const dir = path.join(ROOT, ANIMATIONS_DIR, process.argv[2] ?? 'locomotion');
const files = [];
(function walk(d) {
  for (const entry of readdirSync(d)) {
    const p = path.join(d, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (entry.endsWith('.glb')) files.push(p);
  }
})(dir);

const all = files.flatMap(report);
all.sort((a, b) => b.worstRotDeg - a.worstRotDeg);
console.log('clip'.padEnd(34), 'dur'.padStart(6), 'first'.padStart(6), 'chan'.padStart(5), 'short'.padStart(6), 'wrapRot°'.padStart(9), 'bone'.padEnd(22), 'hips wrap (cm)');
for (const r of all) {
  const h = r.hipsWrapCm;
  const hips = h ? `vert ${h.vFirst.toFixed(1)} -> ${h.vLast.toFixed(1)} (min ${h.vMin.toFixed(1)} max ${h.vMax.toFixed(1)})` : '-';
  console.log(
    r.file.padEnd(34),
    String(r.duration).padStart(6),
    String(r.firstTime).padStart(6),
    String(r.channels).padStart(5),
    String(r.shortTracks).padStart(6),
    String(r.worstRotDeg).padStart(9),
    r.worstRotBone.padEnd(22),
    hips,
  );
}
