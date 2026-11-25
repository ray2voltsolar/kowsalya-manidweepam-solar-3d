// ============================================================================
//  STRUCTURES — geometry kit (world-space helpers + per-material batching)
//  Plan coords (x=E, y=N, z=up)  →  world (x, z, -y)
// ============================================================================
import * as THREE from 'three';

export const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
export const UP = new THREE.Vector3(0, 1, 0);
/** plan direction (dx, dy) → world unit-ish vector */
export const D = (dx, dy, dz = 0) => new THREE.Vector3(dx, dz, -dy);

const KEEP = new Set(['position', 'normal', 'uv', 'color']);
function prep(g) {
  for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) {
    const n = g.attributes.position.count; const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.clearGroups();
  return g;
}

/** Collects geometries per material key and merges them into one mesh each. */
export class Batch {
  constructor() { this.buckets = new Map(); this.colours = new Map(); }
  add(key, g, tint = 0xffffff) {
    let rgb=this.colours.get(tint);
    if(!rgb){
      rgb=new THREE.Color(tint).toArray().map(v=>Math.round(v*65535));
      this.colours.set(tint,rgb);
    }
    const values=new Uint16Array(3*g.attributes.position.count),[r,green,b]=rgb;
    for(let i=0;i<values.length;i+=3){values[i]=r;values[i+1]=green;values[i+2]=b;}
    g.setAttribute('color',new THREE.BufferAttribute(values,3,true));
    prep(g);
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(g);
    return g;
  }
  // Assemble each stage off scene, then publish it atomically. Existing material
  // meshes absorb the new pieces so five loading stages still cost one draw per finish.
  *publish(mats,group,meshes) {
    const changes=[];
    for(const [key,parts] of this.buckets){
      const def=mats[key],existing=meshes.get(key);
      if(!def)throw new Error(`structures: no material '${key}'`);
      if(existing)parts.unshift(existing.geometry);
      const vertexCount=parts.reduce((n,g)=>n+g.attributes.position.count,0);
      const indexCount=parts.reduce((n,g)=>n+g.index.count,0);
      const indices=vertexCount>=65535?new Uint32Array(indexCount):new Uint16Array(indexCount);
      const geo=new THREE.BufferGeometry();
      for(const [name,attr] of Object.entries(parts[0].attributes)){
        geo.setAttribute(name,new THREE.BufferAttribute(new attr.array.constructor(vertexCount*attr.itemSize),attr.itemSize,attr.normalized));
      }
      let vertex=0,index=0;
      for(let i=0;i<parts.length;i++){
        const part=parts[i];
        for(const [name,target] of Object.entries(geo.attributes)){
          target.array.set(part.attributes[name].array,vertex*target.itemSize);
        }
        if(!vertex)indices.set(part.index.array);
        else for(let k=0;k<part.index.count;k++)indices[index+k]=part.index.array[k]+vertex;
        index+=part.index.count;vertex+=part.attributes.position.count;
        if(part!==existing?.geometry){part.dispose();parts[i]=null;}
        if(i%64===0)yield;
      }
      geo.setIndex(new THREE.BufferAttribute(indices,1));geo.computeBoundingSphere();
      changes.push({key,geo,existing,def});
      yield;
    }
    this.buckets.clear();
    for(const {key,geo,existing,def} of changes){
      if(existing){existing.geometry.dispose();existing.geometry=geo;continue;}
      const mesh=new THREE.Mesh(geo,def.material);
      mesh.name=`structures:${key}`;mesh.castShadow=def.cast!==false;
      mesh.receiveShadow=def.receive!==false;mesh.matrixAutoUpdate=false;mesh.updateMatrix();
      mesh.userData.kind='context';meshes.set(key,mesh);group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------
//  Primitive builders (all return world-space BufferGeometry)
// ---------------------------------------------------------------------------

/** Plan-aligned box: w along plan x (before rot), d along plan y, h up, base at z0. rot = plan angle (rad, CCW from east). */
const unitBox=new THREE.BoxGeometry(1,1,1);
export function boxAt(cx,cy,z0,w,d,h,rot=0,metricUV=false) {
  // All rectangular trim uses the same 24 corners, face normals and index.
  // Transform once and write the metric UVs while the position is still in registers.
  const src=unitBox.attributes.position.array,normal=unitBox.attributes.normal.array;
  const pos=new Float32Array(src.length),nor=new Float32Array(src.length);
  const uv=metricUV?new Float32Array(48):null;
  const c=Math.cos(rot),s=Math.sin(rot);
  for(let i=0,j=0;i<src.length;i+=3,j+=2){
    const x=src[i]*w,z=src[i+2]*d;
    pos[i]=cx+c*x+s*z;pos[i+1]=z0+h*(src[i+1]+.5);pos[i+2]=-cy-s*x+c*z;
    nor[i]=c*normal[i]+s*normal[i+2];nor[i+1]=normal[i+1];nor[i+2]=-s*normal[i]+c*normal[i+2];
    if(uv){
      const top=normal[i+1]!==0;
      uv[j]=top || Math.abs(nor[i])<Math.abs(nor[i+2])?pos[i]:pos[i+2];
      uv[j+1]=top?pos[i+2]:pos[i+1];
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('normal',new THREE.BufferAttribute(nor,3));
  g.setAttribute('uv',uv?new THREE.BufferAttribute(uv,2):unitBox.attributes.uv);
  g.setIndex(unitBox.index);
  return g;
}

/** Oriented box from centre and orthonormal axes (sizes along each). */
export function orientedBox(center, ex, ey, ez, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  let z = ez;
  if (new THREE.Vector3().crossVectors(ex, ey).dot(ez) < 0) z = ez.clone().negate();
  const m = new THREE.Matrix4().makeBasis(ex, ey, z).setPosition(center);
  g.applyMatrix4(m);
  return g;
}

/** Rectangular member between world points a→b; w = width across (⊥ to up), h = depth along 'up' hint. */
export function beam(a, b, w, h, up = UP) {
  const L = a.distanceTo(b);
  const ez = new THREE.Vector3().subVectors(b, a).normalize();
  let ex = new THREE.Vector3().crossVectors(up, ez);
  if (ex.lengthSq() < 1e-8) ex = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), ez);
  ex.normalize();
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
  const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return orientedBox(c, ex, ey, ez, w, h, L);
}

/** Cylinder between world points (r0 at a, r1 at b). */
export function cylBetween(a, b, r0, seg = 8, r1 = r0, open = false) {
  const L = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, open);
  const ey = new THREE.Vector3().subVectors(b, a).normalize();
  const ref = Math.abs(ey.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const ex = new THREE.Vector3().crossVectors(ey, ref).normalize();
  const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();
  const m = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

/** Box-projection UVs from world coords (metres × scale). vOffset lets v start at 0 at ground. */
export function boxUV(g, su, sv = su, opts = {}) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const ou = opts.ou || 0, ov = opts.ov || 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x * (opts.topScale || su); v = z * (opts.topScale || su); }
    else if (nx >= nz) { u = z * su; v = y * sv; }
    else { u = x * su; v = y * sv; }
    uv[i * 2] = u + ou; uv[i * 2 + 1] = v + ov;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Revolve a profile [[r, y], ...] around world Y (origin). Sharp creases where the
 * profile turns more than ~35°, smooth elsewhere. UV: u around × uRep, v = profile length × vScale
 * (or v = (y - vFromY[0]) * vFromY[1] when vFromY given).
 */
export function revolve(profile, seg = 24, opts = {}) {
  const uRep = opts.uRep || 1, vScale = opts.vScale || 1;
  const phi0 = opts.phiStart || 0, phiL = opts.phiLength || Math.PI * 2;
  const n = profile.length;
  const segN = []; const segLen = [];
  for (let j = 0; j < n - 1; j++) {
    const dr = profile[j + 1][0] - profile[j][0], dy = profile[j + 1][1] - profile[j][1];
    const l = Math.hypot(dr, dy) || 1e-6; segLen.push(l);
    segN.push([dy / l, -dr / l]); // outward normal in (r, y)
  }
  const cum = [0]; for (let j = 0; j < n - 1; j++) cum.push(cum[j] + segLen[j]);
  const cosT = Math.cos(35 * Math.PI / 180);
  const pos = [], nor = [], uv = [], idx = [];
  for (let s = 0; s < n - 1; s++) {
    const ends = [s, s + 1];
    const nrm = ends.map((j, k) => {
      const other = k === 0 ? s - 1 : s + 1;
      if (other < 0 || other >= n - 1) return segN[s];
      const a = segN[s], b = segN[other];
      if (a[0] * b[0] + a[1] * b[1] > cosT) { const x = a[0] + b[0], y = a[1] + b[1]; const l = Math.hypot(x, y); return [x / l, y / l]; }
      return a;
    });
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const ph = phi0 + phiL * i / seg; const c = Math.cos(ph), sn = Math.sin(ph);
      for (let k = 0; k < 2; k++) {
        const [r, y] = profile[ends[k]];
        pos.push(r * c, y, -r * sn);
        nor.push(nrm[k][0] * c, nrm[k][1], -nrm[k][0] * sn);
        const v = opts.vFromY ? (y - opts.vFromY[0]) * opts.vFromY[1] : cum[ends[k]] * vScale;
        uv.push(i / seg * uRep, v);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2, b = a + 1, c2 = a + 2, d = a + 3;
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

/** Make triangle winding agree with the stored normals (per triangle). */
export function fixWinding(g) {
  const p = g.attributes.position, nrm = g.attributes.normal, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) {
    a.fromBufferAttribute(p, ix[t]); b.fromBufferAttribute(p, ix[t + 1]); c.fromBufferAttribute(p, ix[t + 2]);
    n.subVectors(b, a).cross(c.sub(a));
    m.fromBufferAttribute(nrm, ix[t]).add(b.fromBufferAttribute(nrm, ix[t + 1])).add(c.fromBufferAttribute(nrm, ix[t + 2]));
    if (n.dot(m) < 0) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
  }
  return g;
}

/** Translate geometry to a plan point (base at z). */
export function placeAt(g, x, y, z = 0) { g.translate(x, z, -y); return g; }

/** Tube along a polyline of world points with rounded bends. */
export function tubePath(points, r, radialSeg = 10, bendR = 0.3, spacing = 0.2) {
  points = points.filter((p, i) => i === 0 || p.distanceTo(points[i - 1]) > 1e-4);
  const path = new THREE.CurvePath();
  let prev = points[0].clone();
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], a = points[i - 1], b = points[i + 1];
    const da = p.distanceTo(a), db = p.distanceTo(b);
    const rr = Math.min(bendR, da * 0.45, db * 0.45);
    const pA = p.clone().addScaledVector(new THREE.Vector3().subVectors(a, p).normalize(), rr);
    const pB = p.clone().addScaledVector(new THREE.Vector3().subVectors(b, p).normalize(), rr);
    if (prev.distanceTo(pA) > 1e-4) path.add(new THREE.LineCurve3(prev, pA));
    path.add(new THREE.QuadraticBezierCurve3(pA, p.clone(), pB));
    prev = pB;
  }
  path.add(new THREE.LineCurve3(prev, points[points.length - 1].clone()));
  const L = path.getLength();
  const segs = Math.max(4, Math.min(400, Math.ceil(L / spacing) + (points.length - 2) * 6));
  return new THREE.TubeGeometry(path, segs, r, radialSeg, false);
}

/** Parabolic sag approximation of a catenary between world points. */
export function catenary(p, q, sag, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = p.clone().lerp(q, t); v.y -= sag * 4 * t * (1 - t);
    pts.push(v);
  }
  return pts;
}

/** Simple tube through points (no bend rounding) — for wires. */
export function wireTube(points, r, radialSeg = 4) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, points.length * 2, r, radialSeg, false);
}

/** Seeded RNG. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
