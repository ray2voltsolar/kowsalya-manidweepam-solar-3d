// ============================================================================
//  Camera rig: perspective + orthographic cameras sharing one OrbitControls,
//  framing-preserving projection toggle, animated preset views, drone orbit.
//  View state = { target: Vector3, theta, phi, dist, fov } where `dist` is the
//  perspective-equivalent distance (ortho half-height = dist·tan(fov/2)).
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { SITE, BUILDING, BLOCKS, COMPOUND, INVERTER_STATIONS, TABLES, ROOF, OBSTACLES, pointInRing } from '../site-data.js';

const ORTHO_H0 = 50;        // base half-height of the ortho frustum (zoom 1)
const ORTHO_STANDOFF = 210; // ortho camera distance from the target
const ORTHO_FAR = 4000;
// elevations: only ≈ 140 m of depth behind the section line — in ortho every far context tree is drawn full size and
// thousands of them merged into a flat green-grey wall behind the site (and differed per direction)
const ELEV_DEPTH = 140;
const DEG = Math.PI / 180;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const P = (a) => new THREE.Vector3(a[0], a[2], -a[1]); // plan → world

const { x, y } = SITE.center;
const z = BUILDING.roofZ;
const gate = COMPOUND.gate;
const station = INVERTER_STATIONS[0];
const outline = ROOF.polygons.flatMap(p => p.outer);
const extent = axis => Math.max(...outline.map(p => p[axis])) - Math.min(...outline.map(p => p[axis]));
const width = extent(0), depth = extent(1);
const overview = {
  cam: [x - width * 1.10, y - depth * 1.20, z + depth * .98],
  target: [x - width * .07, y - depth * .06, z * .40], fov: 40,
};

// A phone can change its available frame while the preset stays selected.
// Fit the silhouette in camera space once, then adjust only the lens as the sheet moves.
function fitSilhouette(target, dir, dist, footprint, base) {
  const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right);
  const delta = new THREE.Vector3();
  let sx, sy;
  for (let pass = 0; pass < 3; pass++) {
    let left = Infinity, rightmost = -Infinity, bottom = Infinity, top = -Infinity;
    for (const [east,north] of footprint) for (const height of [base, z + BUILDING.parapet.height]) {
      delta.set(east,height,-north).sub(target);
      const depth = dist - delta.dot(dir);
      const u = delta.dot(right)/depth, v = delta.dot(up)/depth;
      left = Math.min(left,u); rightmost = Math.max(rightmost,u);
      bottom = Math.min(bottom,v); top = Math.max(top,v);
    }
    sx = rightmost-left; sy = top-bottom;
    if (pass < 2) target.addScaledVector(right,dist*(left+rightmost)/2).addScaledVector(up,dist*(bottom+top)/2);
  }
  return { target, sx, sy };
}

const plan = {ortho: true, plan: true, target: [x, y, z], halfH: depth / (2 * .85)};
const clearTerrace = (east, north, margin = .12) =>
  ROOF.polygons.some(p => pointInRing(east, north, p.outer) && !p.holes.some(h => pointInRing(east, north, h))) &&
  !TABLES.some(t => east >= t.x0 - margin && east <= t.x1 + margin && north >= t.ySouth - margin && north <= t.yNorth + margin) &&
  !OBSTACLES.some(o => east >= o.x0 - margin && east <= o.x1 + margin && north >= o.y0 - margin && north <= o.y1 + margin);

// Compose the rear support from open terrace on its north-east side. A clear
// sightline at the end of the table also works for the taller portal frames.
function structureView() {
  const tables = [...TABLES].sort((a,b) => b.rows - a.rows || b.cols - a.cols);
  for (const t of tables) {
    for (const back of [3.3, 2.6, 1.9, 1.4]) {
      const east = t.x1 + .55, north = t.yNorth + back;
      const targetX = t.x1 - Math.min(2.1, (t.x1 - t.x0) * .35);
      const dx = targetX - east;
      const clear = [0, .25, .5, .75].every(s => {
        const px = east + s * dx, py = north - s * back;
        return clearTerrace(px, py) && [-.8, 0, .8].every(side => {
          const sx = px + side * s * back, sy = py + side * s * dx;
          return !OBSTACLES.some(o => sx > o.x0-.4 && sx < o.x1+.4 && sy > o.y0-.4 && sy < o.y1+.4);
        });
      });
      if (clear) {
        return {cam: [east, north, z + 1.3], target: [targetX, t.yNorth - .15, z + Math.min(1.35, (t.zHigh - z) * .45)], fov: 53};
      }
    }
  }
  return terraceView();
}

function arrayView() {
  const tables = TABLES.filter(t => t.block === 'B');
  const middle = t => [(t.x0 + t.x1) / 2, (t.yNorth + t.ySouth) / 2];
  // Compose four neighbouring tables toward the outer edge of the east wing.
  const clusters = tables.map(t => {
    const [cx, cy] = middle(t);
    const near = tables.map(v => middle(v)).sort((a,b) =>
      Math.hypot(a[0]-cx, a[1]-cy) - Math.hypot(b[0]-cx, b[1]-cy)).slice(0,4);
    const east = near.reduce((sum,p) => sum + p[0], 0) / near.length;
    const north = near.reduce((sum,p) => sum + p[1], 0) / near.length;
    const spread = Math.max(...near.map(p => Math.hypot(p[0]-east,p[1]-north)));
    return {east, north, top:(t.zHigh+t.zLow)/2, score:spread + Math.abs(east-BLOCKS.B.bounds.x1)*.16};
  });
  const best = clusters.sort((a,b) => a.score-b.score)[0];
  const range = 15, pitch = 25 * DEG, bearing = 27 * DEG;
  return {cam:[best.east + range*Math.cos(pitch)*Math.sin(bearing), best.north - range*Math.cos(pitch)*Math.cos(bearing), best.top + range*Math.sin(pitch)],
    target:[best.east,best.north,best.top], fov:53};
}

// Walk along a shared gap between long rows. Test against ducts and furniture because
// two adjacent tables can also sit on opposite sides of a light well.
function terraceView(walkway = false) {
  const choices = [];
  for (const a of TABLES) for (const b of TABLES) {
    const gap = b.ySouth - a.yNorth;
    const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
    if (gap < .44 || gap > 3 || hi - lo < 3) continue;
    const north = a.yNorth + gap / 2, east = lo + .45;
    const clear = Array.from({length: 7}, (_, i) => east + i * (hi - east) / 7).every(px => clearTerrace(px, north));
    if (clear) choices.push({east, north, gap, length: hi - lo, targetHeight: (a.zLow + a.zHigh) / 2});
  }
  const score = c => walkway ? Math.min(c.length, 12) * Math.min(c.gap, 2.5) : c.length;
  choices.sort((a,b) => score(b) - score(a));
  const row = TABLES[0];
  const aisle = choices[0] || {east: row.x0, north: row.ySouth - .35, length: row.x1 - row.x0, targetHeight: row.zLow};
  if (walkway) return {cam:[aisle.east, aisle.north, z + 1.65], target:[aisle.east + .85 * aisle.length, aisle.north - .24, z + .74], fov:65};
  return {cam: [aisle.east, aisle.north, z + 1.7], target: [aisle.east + aisle.length, aisle.north + 1.5, aisle.targetHeight], fov: 59};
}

export function inverterView(st) {
  const [nx, ny] = st.normal || ({N:[0,1],S:[0,-1],E:[1,0],W:[-1,0]}[st.wall]);
  const eye = d => [st.x + nx*d + ny*.65, st.y + ny*d - nx*.65, st.z+1.7];
  // Keep the photographer in an access aisle even when the active preset fills more roof.
  const clear = ([px,py]) => clearTerrace(px, py, 0);
  const dist = [4.8,4.4,4,3.6,3.2,2.8,2.4].find(d => clear(eye(d))) || 2;
  return {cam: eye(dist), target: [st.x,st.y,st.z+1.45], fov: 49};
}

// These four camera placements search the roof tables. Only do that work when
// somebody visits the preset; the view menu only needs the label and group.
function detailPreset(label, group, solve, key) {
  let pose;
  const get = () => (pose ??= solve());
  return {label, group, key, get cam() { return get().cam; },
    get target() { return get().target; }, get fov() { return get().fov; }};
}

export const VIEWS = {
  overview: { ...overview, label: 'Overview', key: '1', group: 'main' },
  hero: {label:'South-west aerial', group:'main', cam:[x-107,y-117,z+64], target:[x-8,y-15,z*.30], fov:40},
  heroNE: {label:'North-east aerial', group:'main', cam:[x+147,y+66,z+65], target:[x+10,y+5,z*.28], fov:40},
  plan: {...plan, label:'Plan', key:'2', group:'main'},
  top: {...plan, label:'Plan', alias:'plan'},
  ...Object.fromEntries(Object.values(BLOCKS).map((b, i) => {
    const {x0, x1, y0, y1} = b.bounds;
    const cx = (x1 + x0) / 2, cy = (y1 + y0) / 2, span = Math.max(x1 - x0, y1 - y0);
    return ['block' + b.id, {label: 'Block ' + b.id, title: b.name, key: String(3 + i), group: 'roof',
      cam: [cx - span * .32, cy - span * .88, z + span * .77], target: [cx, cy, z], fov: 42}];
  })),
  road: {label: 'Main road', key: '6', group: 'street', cam: [-92,-78,1.7], target: [-60,-40,11], fov: 60},
  gate: {label: 'Entrance', key: '7', group: 'street', cam: [gate.x - 9,gate.y - 2,1.7], target: [gate.x + 9,gate.y + 3,3.5], fov: 58},
  terrace: detailPreset('Terrace', 'detail', terraceView, '8'),
  detailArray: detailPreset('East wing arrays', 'roof', arrayView),
  detailStructure: detailPreset('Mounting detail', 'detail', structureView),
  walkway: detailPreset('Row walkway', 'detail', () => terraceView(true)),
  inverter: {label: 'Inverters', key: '9', group: 'detail', ...inverterView(station)},
  drone: {...overview, label: 'Drone orbit', key: '0', group: 'main', drone: true},
  ...Object.fromEntries([['N','North',0,1],['S','South',0,-1],['E','East',1,0],['W','West',-1,0]].map(([k, name, dx, dy]) =>
    ['elev'+k, {label:k, title:name+' elevation', ortho:true, dir:[dx,dy,0], target:[x,y,z/2],
      span:[(dx ? depth : width) * 1.035, z + 7], ground:.25, clip:(dx ? width : depth) * .53 + 1, group:'elev'}])),
};

export class CameraRig {
  constructor(domElement) {
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.3, 9000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, ORTHO_FAR);
    this.persp.position.set(80, 50, 30);
    this.camera = this.persp;
    this.mode = 'persp';
    this.fov = 40; // fov used for ortho-equivalent distance
    this.w = 1; this.h = 1; this.offsetPx = 0;
    this.listeners = new Set();
    this.phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
    if (this.phone) {
      // Opening the title card moves the compass down without resizing the canvas.
      let tucked = document.body.classList.contains('brand-collapsed');
      new MutationObserver(() => {
        const next = document.body.classList.contains('brand-collapsed');
        if (next !== tucked && this.h > this.w) this.setSize(this.w, this.h);
        tucked = next;
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      this.viewbar = document.querySelector('#viewbar');
      this.viewbar.addEventListener('transitionend', e => {
        if (e.target === this.viewbar && e.propertyName === 'bottom' && this.h > this.w) this.setSize(this.w, this.h);
      });
    }

    const c = new OrbitControls(this.persp, domElement);
    c.enableDamping = true; c.dampingFactor = 0.085;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.minDistance = 2.5; c.maxDistance = 1400;
    c.minZoom = 0.25; c.maxZoom = 60;
    c.maxPolarAngle = Math.PI / 2 + 0.28; // street views look slightly up; ground clamp prevents going under
    c.rotateSpeed = 0.7; c.panSpeed = 0.9; c.zoomSpeed = 1.0;
    c.autoRotateSpeed = 0.48;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls = c;
    this.anim = null;
    this.currentView = null;
    this.installGestures(domElement);
    let interacting = false;
    c.addEventListener('start', () => {
      interacting = true;
      this.cancelAnim();
      if (c.autoRotate) { c.autoRotate = false; this._emit('drone', false); }
      if (this.ortho.near !== 1 || this.ortho.far !== ORTHO_FAR) { this.ortho.near = 1; this.ortho.far = ORTHO_FAR; this.ortho.updateProjectionMatrix(); }
    });
    c.addEventListener('change', () => {
      if (interacting && this.currentView) {
        this.currentView = null;
        this._emit('view', null);
      }
    });
    c.addEventListener('end', () => { interacting = false; });
  }

  installGestures(canvas) {
    const c = this.controls;
    const fingers = new Set();
    let tap = null, last = null, lastTouch = -Infinity;
    canvas.addEventListener('pointerdown', e => {
      // The vendored r170 controls expose no public damping reset. Clear only
      // the outstanding rotation and pan, preserving the current camera pose.
      c._sphericalDelta.set(0, 0, 0);
      c._panOffset.set(0, 0, 0);
      this.cancelAnim();
      if (e.pointerType !== 'touch') return;
      fingers.add(e.pointerId);
      tap = fingers.size === 1 ? {id:e.pointerId, x:e.clientX, y:e.clientY, t:e.timeStamp} : null;
      if (!tap) last = null;
    }, true);
    canvas.addEventListener('pointermove', e => {
      if (tap?.id === e.pointerId && Math.hypot(e.clientX-tap.x, e.clientY-tap.y) > 5) tap = last = null;
    });
    const release = e => {
      if (!fingers.delete(e.pointerId)) return;
      lastTouch = e.timeStamp;
      if (e.type === 'pointerup' && tap?.id === e.pointerId && e.timeStamp-tap.t <= 300 &&
          Math.hypot(e.clientX-tap.x,e.clientY-tap.y) <= 5) {
        if (last && e.timeStamp-last.t <= 300 && Math.hypot(e.clientX-last.x,e.clientY-last.y) <= 24) {
          last = null;
          this.onDoubleTap?.(e.clientX, e.clientY);
        } else last = {x:e.clientX, y:e.clientY, t:e.timeStamp};
      } else last = null;
      tap = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('dblclick', e => {
      if (e.button === 0 && e.timeStamp-lastTouch > 500) this.onDoubleTap?.(e.clientX, e.clientY);
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(type, v) { for (const fn of this.listeners) fn(type, v); }

  /** offsetPx: width covered by the side panel (right); offsetY: height covered by the phone sheet (bottom). */
  setSize(w, h, offsetPx = this.offsetPx, offsetY = this.offsetY || 0) {
    const resized = w !== this.w || h !== this.h;
    // Rotation can report the old landscape offset while the view bar is still
    // sliding into its portrait position. Use its painted edge for the closed sheet.
    if (this.phone && h > w && document.body.matches('.panel-collapsed:not(.bottom-hidden):not(.clean)')) {
      offsetY = Math.max(0, h - this.viewbar.getBoundingClientRect().top);
    }
    this.w = w; this.h = h; this.offsetPx = offsetPx; this.offsetY = offsetY;
    if (this.phone) {
      this.controls.dampingFactor = .18;
      this.controls.rotateSpeed = .5 * h / w;
      this.topInset = document.body.classList.contains('clean') ? 0 :
        Math.ceil(document.querySelector(document.body.classList.contains('brand-collapsed') ? '#brandOpen' : '#brand')?.getBoundingClientRect().bottom || 0);
      this.bottomInset = offsetY;
      if (h > w && !document.body.classList.contains('clean')) {
        this.topInset = Math.max(this.topInset, document.querySelector('#compass').getBoundingClientRect().bottom);
        const restore = getComputedStyle(document.querySelector('#bottomOpen'));
        const restoreHeight = Math.max(parseFloat(restore.height), parseFloat(restore.minHeight));
        this.bottomInset = Math.max(offsetY, restoreHeight + parseFloat(restore.bottom));
      }
    }
    this.updateProjection();
    // Resize events can arrive ahead of the panel-offset easing in main.
    // Refit until the new orientation has settled, unless the user takes over.
    if (this.phone && resized) this.refitUntil = performance.now() + 1500;
    const portraitOverview = this.currentView === 'overview' && h > w &&
      (document.body.classList.contains('panel-collapsed') || document.body.classList.contains('bottom-hidden'));
    if (this.phone && this.currentView && !this.controls.autoRotate && (portraitOverview || performance.now() < this.refitUntil)) {
      if (!this.anim) this.applyState(this.viewState(this.currentView));
      else if (this.currentView === 'overview') {
        this.anim.to = this.viewState('overview');
        const delta = this.anim.to.theta - this.anim.from.theta;
        this.anim.dTheta = Math.atan2(Math.sin(delta), Math.cos(delta));
      }
    }
  }

  /** Virtual full frame: the visible area (w-off)×(h-offY) is centred in a (w+off)×(h+offY) frustum. */
  updateProjection() {
    const w = this.w, h = this.h, off = Math.max(0, Math.round(this.offsetPx)), offY = Math.max(0, Math.round(this.offsetY || 0));
    const fullW = w + off, fullH = h + offY;
    const aspect = fullW / fullH;
    const p = this.persp;
    p.aspect = aspect;
    const originY = (offY + Math.round(this.bottomInset ?? offY) - (this.topInset || 0)) / 2;
    if (off || originY) p.setViewOffset(fullW, fullH, off, originY, w, h); else p.clearViewOffset();
    p.updateProjectionMatrix();
    const o = this.ortho;
    o.left = -ORTHO_H0 * aspect; o.right = ORTHO_H0 * aspect; o.top = ORTHO_H0; o.bottom = -ORTHO_H0;
    if (off || originY) o.setViewOffset(fullW, fullH, off, originY, w, h); else o.clearViewOffset();
    o.updateProjectionMatrix();
  }

  /**
   * Lens scale so a preset (composed for a 16:10 window) still
   * fits the visible area (window minus side panel / bottom sheet). 1 on a normal desktop.
   */
  fitFactor() {
    const off = Math.max(0, this.offsetPx || 0), offY = Math.max(0, this.offsetY || 0);
    const fullH = this.h + offY;
    const visW = Math.max(1, this.w - off), visH = Math.max(1, this.h - offY);
    // content spans ≈1.2 frame-heights wide and ≈0.8 high (in units of the full-frustum height)
    const f = Math.max(1, 1.2 * fullH / visW, 0.8 * fullH / visH);
    return Math.min(3.4, f);
  }

  /** Metres per CSS pixel at the target (ortho exact; persp at target distance). */
  metresPerPixel() {
    if (this.mode === 'ortho') return (2 * ORTHO_H0 / this.ortho.zoom) / (this.h + (this.offsetY || 0));
    const d = this.camera.position.distanceTo(this.controls.target);
    return (2 * d * Math.tan(this.persp.fov * DEG / 2)) / (this.h + (this.offsetY || 0));
  }

  getState() {
    const t = this.controls.target.clone();
    const off = this.camera.position.clone().sub(t);
    const s = new THREE.Spherical().setFromVector3(off);
    const fov = this.mode === 'persp' ? this.persp.fov : this.fov;
    const dist = this.mode === 'persp' ? s.radius : (ORTHO_H0 / this.ortho.zoom) / Math.tan(fov * DEG / 2);
    return { target: t, theta: s.theta, phi: s.phi, dist, fov };
  }

  applyState(st) {
    const cam = this.camera;
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, Math.max(1e-4, st.phi), st.theta));
    this.controls.target.copy(st.target);
    if (this.mode === 'persp') {
      if (Math.abs(this.persp.fov - st.fov) > 1e-3) { this.persp.fov = st.fov; this.persp.updateProjectionMatrix(); }
      cam.position.copy(st.target).addScaledVector(dir, st.dist);
    } else {
      this.fov = st.fov;
      cam.position.copy(st.target).addScaledVector(dir, ORTHO_STANDOFF);
      this.ortho.zoom = ORTHO_H0 / (st.dist * Math.tan(st.fov * DEG / 2));
      this.ortho.updateProjectionMatrix();
    }
    cam.lookAt(st.target);
  }

  /** Switch projection, keeping the view direction & framing. */
  setMode(mode) {
    if (mode === this.mode) return;
    const st = this.getState();
    this.mode = mode;
    this.camera = mode === 'ortho' ? this.ortho : this.persp;
    if (mode === 'persp') {
      // From a straight-down plan view, tilt a touch so orbiting feels natural
      st.fov = this.fov;
    }
    if (mode === 'ortho') { this.ortho.near = 1; this.ortho.far = ORTHO_FAR; this.ortho.updateProjectionMatrix(); }
    this.controls.object = this.camera;
    this.applyState(st);
    this.controls.update();
    this._emit('mode', mode);
  }

  viewState(name) {
    const v = VIEWS[name]; if (!v) return null;
    const target = P(v.target);
    let fov = v.fov || 40;
    let dir, dist;
    if (v.ortho) {
      if (v.plan) dir = new THREE.Vector3(0, 1, 0.0001).normalize();
      else dir = P(v.dir).normalize();
      if (v.span) {
        // fit [width, height] into the visible area exactly (ortho half-height is of the full frustum)
        const off = Math.max(0, this.offsetPx || 0), offY = Math.max(0, this.offsetY || 0);
        const fullH = this.h + offY;
        const visW = Math.max(1, this.w - off), visH = Math.max(1, this.h - offY);
        const g = v.ground || 0.15;
        const halfH = Math.max(1.06 * v.span[0] * fullH / (2 * visW), (v.span[1] * 1.08 / (1 - g)) * fullH / (2 * visH));
        dist = halfH / Math.tan(fov * DEG / 2);
        // vertical: ground line g·visibleHeight above the bottom of the visible area
        const hv = halfH * visH / fullH;
        target.y = hv * (1 - 2 * g);
      } else {
        dist = v.halfH / Math.tan(fov * DEG / 2);
        // the halfH is for a 16:10 screen; narrower visible areas (portrait, panel open) widen
        dist *= Math.max(1, (this.h + this.offsetY) / Math.max(1, this.h - this.offsetY - (this.topInset || 0)), (width / depth) * (this.h + this.offsetY) / (this.w - this.offsetPx));
      }
    } else {
      const off = P(v.cam).sub(target);
      dist = off.length(); dir = off.normalize();
      if (this.phone && (name === 'overview' || name.startsWith('block'))) {
        const portrait = name === 'overview' && this.h > this.w;
        // Look along the long axis from the south-west, keeping the west and south façades visible.
        if (portrait) dir.setFromSphericalCoords(1, (90 - 52) * DEG, -18 * DEG);
        const b = BLOCKS[name.slice(5)]?.bounds;
        const footprint = b ? [[b.x0,b.y0],[b.x0,b.y1],[b.x1,b.y0],[b.x1,b.y1]] : outline;
        const fit = portrait
          ? (this.portraitFit ??= fitSilhouette(target.clone(), dir, dist, outline, 0))
          : fitSilhouette(target, dir, dist, footprint, b ? z : 0);
        target.copy(fit.target);
        const freeW = Math.max(1,this.w-this.offsetPx), freeH = Math.max(1,this.h-this.bottomInset-this.topInset);
        const tan = .5 * (this.h+this.offsetY) * Math.max(fit.sx/((portrait ? .905 : .85)*freeW), fit.sy/(.84*freeH));
        fov = 2 * Math.atan(tan) / DEG;
      } else if (v.group !== 'street' && (v.group !== 'detail' || name === 'inverter')) {
        // Widen the lens in portrait. Moving hundreds of metres away would put the
        // mobile overview inside the satellite terrain's atmospheric fade.
        fov = 2 * Math.atan(Math.tan(fov * DEG / 2) * this.fitFactor()) / DEG;
      }
    }
    const s = new THREE.Spherical().setFromVector3(dir);
    return { target, theta: s.theta, phi: Math.max(1e-4, s.phi), dist, fov, ortho: !!v.ortho, clip: v.clip || 0, drone: !!v.drone };
  }

  cancelAnim() {
    if (this.anim) { const a = this.anim; this.anim = null; this.controls.enabled = true; a.resolve && a.resolve(false); }
  }

  /** Animate to a preset view. Returns a Promise resolved when arrived. */
  flyTo(name, { duration = 1.2, instant = false } = {}) {
    const v = VIEWS[name];
    const to = this.viewState(name);
    if (!to) return Promise.resolve(false);
    this.cancelAnim();
    if (this.controls.autoRotate && !to.drone) { this.controls.autoRotate = false; this._emit('drone', false); }
    this.setMode(to.ortho ? 'ortho' : 'persp');
    this.currentView = name; this._emit('view', name);
    const from = this.getState();
    if (this.mode === 'ortho') {
      this.ortho.near = to.clip ? Math.max(1, ORTHO_STANDOFF - to.clip) : 1;
      this.ortho.far = to.clip ? ORTHO_STANDOFF + ELEV_DEPTH : ORTHO_FAR;
      this.ortho.updateProjectionMatrix();
    }
    // shortest theta path
    let dTheta = to.theta - from.theta;
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    // plan view: theta is irrelevant at phi≈0 — force north-up (theta 0)
    if (v.plan) dTheta = -from.theta + Math.round(from.theta / (2 * Math.PI)) * 2 * Math.PI;
    return new Promise((resolve) => {
      const a = { from, to, dTheta, t: 0, duration: instant ? 0 : duration, resolve, drone: to.drone };
      this.anim = a;
      this.controls.enabled = false;
      if (instant) this._step(1e9);
    });
  }

  _step(dt) {
    const a = this.anim; if (!a) return;
    a.t = a.duration > 0 ? Math.min(1, a.t + dt / a.duration) : 1;
    const k = easeInOut(a.t);
    const f = a.from, t = a.to;
    // arc the camera up a little during long moves for a nicer "flight"
    const st = {
      target: f.target.clone().lerp(t.target, k),
      theta: f.theta + a.dTheta * k,
      phi: f.phi + (t.phi - f.phi) * k,
      dist: Math.exp(Math.log(f.dist) + (Math.log(t.dist) - Math.log(f.dist)) * k),
      fov: f.fov + (t.fov - f.fov) * k,
    };
    this.applyState(st);
    if (a.t >= 1) {
      this.anim = null;
      this.controls.enabled = true;
      this.controls.update();
      if (a.drone) { this.controls.autoRotate = true; this._emit('drone', true); }
      a.resolve(true);
    }
  }

  stopDrone() { if (this.controls.autoRotate) { this.controls.autoRotate = false; this._emit('drone', false); } }

  /** Fly to an arbitrary point (e.g. a module), looking from the current direction. */
  focusOn(worldPoint, dist, { duration = 0.5 } = {}) {
    this.cancelAnim();
    this.stopDrone();
    if (this.mode === 'ortho' && this.camera.position.clone().sub(this.controls.target).normalize().y < 0.95) this.setMode('persp');
    const from = this.getState();
    const to = { ...from, target: worldPoint.clone(), dist: dist ?? Math.max(12, from.dist / 2),
      phi: dist === undefined ? from.phi : Math.min(from.phi, 1.05) };
    this.currentView = null; this._emit('view', null);
    return new Promise((resolve) => {
      this.anim = { from, to, dTheta: 0, t: 0, duration, resolve };
      this.controls.enabled = false;
    });
  }

  /** Returns true while the camera is moving. */
  update(dt) {
    let moving = false;
    if (this.anim) { this._step(dt); moving = true; } else moving = this.controls.update(dt);
    // never go below ground
    const cam = this.camera;
    if (cam.position.y < 0.45) { cam.position.y = 0.45; cam.lookAt(this.controls.target); }
    if (this.controls.target.y < -2) this.controls.target.y = -2;
    // keep the target near the site
    const t = this.controls.target;
    const R = 600;
    if (Math.abs(t.x - x) > R || Math.abs(t.z + y) > R) { t.x = THREE.MathUtils.clamp(t.x, x - R, x + R); t.z = THREE.MathUtils.clamp(t.z, -y - R, -y + R); }
    return moving || this.controls.autoRotate;
  }

  /** Heading of the view (deg clockwise from north) for the compass. */
  heading() {
    const e = this.camera.matrixWorld.elements;
    const fwd = new THREE.Vector3(-e[8], -e[9], -e[10]);
    const up = new THREE.Vector3(e[4], e[5], e[6]);
    const g = Math.abs(fwd.y) < 0.97 ? fwd : up;
    return Math.atan2(g.x, -g.z) / DEG;
  }
}
