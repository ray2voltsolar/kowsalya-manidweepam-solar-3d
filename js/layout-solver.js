// ============================================================================
//  LAYOUT SOLVER — packs fixed-tilt, south-facing PV tables on the traced RCC
//  terrace.  Pure maths (no three.js); run offline by tools/build-layout.mjs.
//
//  Method
//   1. Rasterise the roof slab (polygons with holes) on a 0.1 m grid.
//   2. Usable area = slab eroded by the edge setback, minus obstacle
//      footprints (+ service clearance), minus every point an obstacle shades
//      at module lower-edge height inside the shade window (21 Dec 09:00-15:00).
//   3. Repeatedly take the axis-aligned rectangle that holds the most modules,
//      fill it with rows (2-portrait tables first, row gap from the same shade
//      window), then block it plus its own shadow strip and an access aisle.
//  Plan frame: x east, y north (m).  Rows run east-west, modules face south.
// ============================================================================
import { dateFromLocal, getSunPosition } from './analysis/sun.js';

const DEG = Math.PI / 180;

/** Sun samples inside the shade window. Returns [{az, el, sx, sy}] where (sx, sy) is the
 *  horizontal shadow displacement (m east, m north) per metre of obstacle height. */
export function shadeWindowSamples(site, win, stepMin = 15) {
  const [h0, m0] = win.from.split(':').map(Number), [h1, m1] = win.to.split(':').map(Number);
  const out = [];
  for (let t = h0 * 60 + m0; t <= h1 * 60 + m1 + 1e-6; t += stepMin) {
    const d = dateFromLocal(2026, win.month, win.day, Math.floor(t / 60), t % 60, site.utcOffsetHours);
    const p = getSunPosition(d, site.lat, site.lng);
    if (p.elevation <= 1) continue;
    const L = 1 / Math.tan(p.elevation * DEG);
    // shadow points away from the sun: sun azimuth az (from north, clockwise) -> shadow direction az + 180
    out.push({ minutes: t, az: p.azimuth, el: p.elevation, sx: -Math.sin(p.azimuth * DEG) * L, sy: -Math.cos(p.azimuth * DEG) * L });
  }
  return out;
}

function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

class Grid {
  constructor(x0, y0, nx, ny, g) { this.x0 = x0; this.y0 = y0; this.nx = nx; this.ny = ny; this.g = g; this.a = new Uint8Array(nx * ny); }
  clone() { const c = new Grid(this.x0, this.y0, this.nx, this.ny, this.g); c.a.set(this.a); return c; }
  count() { let n = 0; for (let i = 0; i < this.a.length; i++) n += this.a[i]; return n; }
  area() { return this.count() * this.g * this.g; }
  /** set cells whose centre lies in [xa,xb]x[ya,yb] to v */
  fillRect(xa, xb, ya, yb, v) {
    const g = this.g;
    const i0 = Math.max(0, Math.ceil((xa - this.x0) / g - 0.5 - 1e-9)), i1 = Math.min(this.nx - 1, Math.floor((xb - this.x0) / g - 0.5 + 1e-9));
    const j0 = Math.max(0, Math.ceil((ya - this.y0) / g - 0.5 - 1e-9)), j1 = Math.min(this.ny - 1, Math.floor((yb - this.y0) / g - 0.5 + 1e-9));
    for (let j = j0; j <= j1; j++) this.a.fill(v, j * this.nx + i0, j * this.nx + i1 + 1);
  }
  /** fill a convex polygon with v */
  fillConvex(pts, v) {
    let ya = Infinity, yb = -Infinity; for (const p of pts) { ya = Math.min(ya, p[1]); yb = Math.max(yb, p[1]); }
    const g = this.g;
    const j0 = Math.max(0, Math.floor((ya - this.y0) / g)), j1 = Math.min(this.ny - 1, Math.ceil((yb - this.y0) / g));
    for (let j = j0; j <= j1; j++) {
      const y = this.y0 + (j + 0.5) * g; let xa = Infinity, xb = -Infinity;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k], q = pts[(k + 1) % pts.length];
        if ((p[1] <= y && q[1] >= y) || (q[1] <= y && p[1] >= y)) {
          const t = Math.abs(q[1] - p[1]) < 1e-12 ? 0 : (y - p[1]) / (q[1] - p[1]);
          const x = p[0] + t * (q[0] - p[0]); xa = Math.min(xa, x); xb = Math.max(xb, x);
          if (Math.abs(q[1] - p[1]) < 1e-12) { xa = Math.min(xa, q[0]); xb = Math.max(xb, q[0]); }
        }
      }
      if (xa > xb) continue;
      const i0 = Math.max(0, Math.ceil((xa - this.x0) / g - 0.5)), i1 = Math.min(this.nx - 1, Math.floor((xb - this.x0) / g - 0.5));
      if (i1 >= i0) this.a.fill(v, j * this.nx + i0, j * this.nx + i1 + 1);
    }
  }
  /** square structuring element of half-size r metres: erode (v=1 keeps only cells whose whole neighbourhood is set) */
  erode(r) { return this._morph(r, true); }
  dilate(r) { return this._morph(r, false); }
  _morph(r, erode) {
    const k = Math.round(r / this.g); if (k <= 0) return this.clone();
    const { nx, ny } = this; const tmp = new Uint8Array(nx * ny), out = new Grid(this.x0, this.y0, nx, ny, this.g);
    const src = this.a; const bad = erode ? 0 : 1;
    // separable: rows then columns. A cell becomes `bad` if any cell within k is `bad` (outside the grid counts as 0).
    for (let j = 0; j < ny; j++) {
      let last = erode ? -1 : -1e9;          // index of last `bad` cell seen (erode: left border is bad)
      const row = j * nx;
      for (let i = 0; i < nx; i++) { if (src[row + i] === bad) last = i; tmp[row + i] = (i - last <= k) ? bad : 1 - bad; }
      last = erode ? nx : 1e9;
      for (let i = nx - 1; i >= 0; i--) { if (src[row + i] === bad) last = i; if (last - i <= k) tmp[row + i] = bad; }
    }
    for (let i = 0; i < nx; i++) {
      let last = erode ? -1 : -1e9;
      for (let j = 0; j < ny; j++) { if (tmp[j * nx + i] === bad) last = j; out.a[j * nx + i] = (j - last <= k) ? bad : 1 - bad; }
      last = erode ? ny : 1e9;
      for (let j = ny - 1; j >= 0; j--) { if (tmp[j * nx + i] === bad) last = j; if (last - j <= k) out.a[j * nx + i] = bad; }
    }
    return out;
  }
}

export function rasteriseRoof(polygons, g = 0.1, pad = 4) {
  let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
  for (const p of polygons) for (const v of p.outer) { xa = Math.min(xa, v[0]); xb = Math.max(xb, v[0]); ya = Math.min(ya, v[1]); yb = Math.max(yb, v[1]); }
  const x0 = Math.floor(xa - pad), y0 = Math.floor(ya - pad);
  const nx = Math.ceil((xb + pad - x0) / g), ny = Math.ceil((yb + pad - y0) / g);
  const grid = new Grid(x0, y0, nx, ny, g);
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * g;
    for (const p of polygons) {
      // scanline crossings for outer + holes (even-odd)
      const xs = [];
      for (const r of [p.outer, ...p.holes]) for (let k = 0, m = r.length - 1; k < r.length; m = k++) {
        const yi = r[k][1], yj = r[m][1];
        if ((yi > y) !== (yj > y)) xs.push(r[k][0] + ((y - yi) / (yj - yi)) * (r[m][0] - r[k][0]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - x0) / g - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / g - 0.5));
        if (i1 >= i0) grid.a.fill(1, j * nx + i0, j * nx + i1 + 1);
      }
    }
  }
  return grid;
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Row arrangement inside a usable depth H (m). Returns tables south->north: [{rows, y (south edge offset), depth}] */
export function rowsInDepth(H, geo) {
  const { d1, d2, g1, g2, allow2 } = geo; let best = null;
  const max2 = allow2 ? Math.floor((H + g2) / (d2 + g2)) : 0;
  for (let n2 = max2; n2 >= 0; n2--) {
    for (let n1 = 0; n1 <= 6; n1++) {
      if (n1 + n2 === 0) continue;
      // order: 1-row tables first (south), 2-row tables to the north (largest shadow last -> no gap needed after it)
      const depth = n1 * d1 + n2 * d2 + (n2 > 0 ? n1 * g1 + (n2 - 1) * g2 : (n1 - 1) * g1);
      if (depth > H + 1e-9) break;
      const rows = n1 + 2 * n2;
      // prefer more module rows, then fewer tables (less structure)
      if (!best || rows > best.rows || (rows === best.rows && n1 + n2 < best.n1 + best.n2)) best = { rows, n1, n2, depth };
    }
  }
  if (!best) return { rows: 0, depth: 0, tables: [] };
  const tables = []; let y = 0;
  for (let i = 0; i < best.n1; i++) { tables.push({ rows: 1, y, depth: d1 }); y += d1 + g1; }
  for (let i = 0; i < best.n2; i++) { tables.push({ rows: 2, y, depth: d2 }); y += d2 + g2; }
  return { rows: best.rows, depth: best.depth, tables };
}

/** Column arrangement inside a usable width W: tables of <= maxCols with `brk` breaks. Returns [{x, cols}] */
export function colsInWidth(W, mw, gx, maxCols, brk) {
  let n = Math.floor((W + gx) / (mw + gx)); if (n <= 0) return { cols: 0, width: 0, tables: [] };
  for (; n > 0; n--) {
    const nt = Math.ceil(n / maxCols); const width = n * mw + (n - nt) * gx + (nt - 1) * brk;
    if (width <= W + 1e-9) {
      const tables = []; let x = 0, left = n;
      for (let t = 0; t < nt; t++) { const c = Math.ceil(left / (nt - t)); tables.push({ x, cols: c }); x += c * mw + (c - 1) * gx + brk; left -= c; }
      return { cols: n, width, tables };
    }
  }
  return { cols: 0, width: 0, tables: [] };
}

/**
 * @param {object} o  { site:{lat,lng,utcOffsetHours}, polygons, obstacles:[{x0,y0,x1,y1,h,type,tank}], module, mounting, cfg,
 *                      rowGap: 'window' | number (fixed gap in m, e.g. 0.5 or 0.02), grid }
 */
export function solveLayout(o) {
  const { site, polygons, obstacles, module: M, mounting: MT, cfg } = o;
  const g = o.grid || 0.1;
  const tilt = cfg.tiltDeg * DEG, gx = 0.02, gs = 0.02;
  const samples = shadeWindowSamples(site, cfg.shadeWindow);
  // northward shadow length per metre of height, worst case in the window (rows face south, so only the north component matters)
  const kN = Math.max(...samples.map((s) => s.sy));
  // east/west shadow reach per metre of height (morning shadows fall west, afternoon shadows east)
  const kE = Math.max(...samples.map((s) => Math.abs(s.sx)));
  const margin = 0.04;                               // m, construction tolerance so the rule is met strictly, not just at the limit
  const rise1 = M.length * Math.sin(tilt), rise2 = (2 * M.length + gs) * Math.sin(tilt);
  const d1 = M.length * Math.cos(tilt), d2 = (2 * M.length + gs) * Math.cos(tilt);
  const minAisle = 0.5;
  const gapFor = (rise) => (o.rowGap === 'window' || o.rowGap == null) ? Math.max(minAisle, kN * rise + margin) : o.rowGap;
  const geo = { d1, d2, g1: gapFor(rise1), g2: gapFor(rise2), allow2: MT.rowsPerTable.includes(2) };

  const slab = rasteriseRoof(polygons, g);
  let base = slab;
  if (MT.spansSlots) base = slab.dilate(MT.maxSlotSpan / 2).erode(MT.maxSlotSpan / 2);     // close ducts <= maxSlotSpan
  // edge setback: access width, but never less than what keeps the parapet's winter shadow off the module lower edge
  const parapetReach = cfg.parapetThickness + Math.max(0, cfg.parapetHeight - MT.lowerEdge) * Math.max(kE, kN) + margin;
  const setback = Math.max(MT.edgeSetback != null ? MT.edgeSetback : cfg.edgeSetback, (o.rowGap === 'window' || o.rowGap == null) ? Math.ceil(parapetReach / g - 1e-9) * g : 0);
  // side aisle between neighbouring arrays: arrays are not row-aligned with each other, so one array's raised north edge can
  // throw a morning/afternoon shadow sideways onto its neighbour; keep them at least that reach apart.
  const sideAisle = (o.rowGap === 'window' || o.rowGap == null) ? Math.max(cfg.arrayAisle, kE * rise2 + margin) : cfg.arrayAisle;
  const usable = base.erode(setback);
  const zRef = MT.lowerEdge;                         // shading is checked at module lower-edge height (conservative)
  let keepOutObstacles = 0;
  for (const ob of obstacles) {
    const hTop = ob.h + (ob.tank ? 1.7 : 0);   // tanks on head-room roofs: 1.7 m assumed (same as tools/shading-study.mjs)
    if (MT.clearsLowObstacles && hTop < MT.lowerEdge - 0.2) continue;       // structure passes over it
    const c = MT.clearsLowObstacles ? 0.3 : cfg.obstacleClearance;
    usable.fillRect(ob.x0 - c, ob.x1 + c, ob.y0 - c, ob.y1 + c, 0); keepOutObstacles++;
    const dh = hTop - zRef; if (dh <= 0.05) continue;
    const corners = [[ob.x0, ob.y0], [ob.x1, ob.y0], [ob.x1, ob.y1], [ob.x0, ob.y1]];
    for (const s of samples) usable.fillConvex(hull(corners.concat(corners.map(([x, y]) => [x + s.sx * dh, y + s.sy * dh]))), 0);
  }
  const usableArea = usable.area();
  const free = usable.clone();
  const { nx, ny } = free; const minW = Math.ceil(M.width / g), minH = Math.ceil(d1 / g);
  const arrays = [];
  const score = (wc, hc) => {
    const W = wc * g, H = hc * g; if (wc < minW || hc < minH) return 0;
    const c = Math.floor((W + gx) / (M.width + gx)); if (c <= 0) return 0;
    // account for table breaks approximately: every maxCols costs a break
    const nt = Math.ceil(c / cfg.maxTableCols); const cc = (c * M.width + (c - nt) * gx + (nt - 1) * cfg.arrayAisle <= W + 1e-9) ? c : c - 1;
    return cc * rowsInDepth(H, geo).rows;
  };
  const heights = new Int32Array(nx);
  for (let iter = 0; iter < 400; iter++) {
    heights.fill(0); let best = null;
    for (let j = 0; j < ny; j++) {
      const row = j * nx; for (let i = 0; i < nx; i++) heights[i] = free.a[row + i] ? heights[i] + 1 : 0;
      const st = [];
      for (let i = 0; i <= nx; i++) {
        const h = i < nx ? heights[i] : 0; let start = i;
        while (st.length && st[st.length - 1][1] >= h) {
          const [s, hh] = st.pop(); const wc = i - s;
          if (hh >= minH && wc >= minW) {
            const sc = score(wc, hh);
            if (sc > 0 && (!best || sc > best.sc || (sc === best.sc && wc * hh < best.wc * best.hc))) best = { sc, i0: s, j1: j, wc, hc: hh };
          }
          start = s;
        }
        if (h > 0) st.push([start, h]);
      }
    }
    if (!best) break;
    const X0 = free.x0 + best.i0 * g, Y0 = free.y0 + (best.j1 - best.hc + 1) * g, W = best.wc * g, H = best.hc * g;
    const rw = rowsInDepth(H, geo), cl = colsInWidth(W, M.width, gx, cfg.maxTableCols, cfg.arrayAisle);
    if (!rw.rows || !cl.cols) { free.fillRect(X0, X0 + W, Y0, Y0 + H, 0); continue; }
    const offX = (W - cl.width) / 2, offY = 0;      // centre east-west, start at the south edge of the rectangle
    const arr = { id: 'AR' + String(arrays.length + 1).padStart(2, '0'), x0: X0 + offX, x1: X0 + offX + cl.width, y0: Y0 + offY, y1: Y0 + offY + rw.depth, tables: [], modules: 0 };
    for (const rt of rw.tables) for (const ct of cl.tables) {
      arr.tables.push({ x: X0 + offX + ct.x, y: Y0 + offY + rt.y, cols: ct.cols, rows: rt.rows }); arr.modules += ct.cols * rt.rows;
    }
    arrays.push(arr);
    // block: the array itself, its own winter shadow strip to the north, a strip to the south so a later table
    // cannot shade it, and an access aisle east/west.
    const topRise = rw.tables[rw.tables.length - 1].rows === 2 ? rise2 : rise1;
    free.fillRect(arr.x0 - sideAisle, arr.x1 + sideAisle, arr.y0 - geo.g2, arr.y1 + gapFor(topRise), 0);
    if (o.rowGap === 'window' || o.rowGap == null) {
      // diagonal morning/afternoon shadows: nothing may start within the sideways shadow reach of this array's top edge
      // (to its north), and no later array to the south may throw its own sideways shadow onto this one.
      const eTop = kE * topRise + margin, eAny = kE * rise2 + margin;
      free.fillRect(arr.x0 - eTop, arr.x1 + eTop, arr.y1, arr.y1 + gapFor(topRise), 0);
      free.fillRect(arr.x0 - eAny, arr.x1 + eAny, arr.y0 - geo.g2, arr.y0, 0);
    }
  }
  const total = arrays.reduce((s, a) => s + a.modules, 0);
  return {
    arrays, modules: total, kwp: total * M.wp / 1000,
    geometry: { tiltDeg: cfg.tiltDeg, d1, d2, rise1, rise2, gap1: geo.g1, gap2: geo.g2, pitch2: d2 + geo.g2, pitch1: d1 + geo.g1, kN, kE, margin, edgeSetback: setback, sideAisle,
      gcr: (2 * M.length + gs) / (d2 + geo.g2), worstSample: samples.reduce((a, b) => (b.sy > a.sy ? b : a)) },
    areas: { slabGross: slab.area(), usable: usableArea, moduleArea: total * M.length * M.width },
    keepOutObstacles, samples,
  };
}

/** Expand arrays -> flat module list (plan-frame top-glass corners). zRoof = terrace finish level. */
export function expandModules(arrays, M, MT, cfg, zRoof) {
  const tilt = cfg.tiltDeg * DEG, c = Math.cos(tilt), s = Math.sin(tilt), gx = 0.02, gs = 0.02;
  const mods = []; const tables = [];
  for (const a of arrays) {
    a.tables.forEach((t, ti) => {
      const tid = `${a.id}-T${ti + 1}`;
      const slopeLen = t.rows * M.length + (t.rows - 1) * gs;
      tables.push({ id: tid, array: a.id, block: a.block, x0: t.x, x1: t.x + t.cols * M.width + (t.cols - 1) * gx, ySouth: t.y, yNorth: t.y + slopeLen * c,
        zLow: zRoof + MT.lowerEdge, zHigh: zRoof + MT.lowerEdge + slopeLen * s, cols: t.cols, rows: t.rows, slopeLen });
      for (let r = 0; r < t.rows; r++) for (let k = 0; k < t.cols; k++) {
        const xa = t.x + k * (M.width + gx), xb = xa + M.width;
        const u0 = r * (M.length + gs), u1 = u0 + M.length;       // distance up the slope from the lower edge
        const ya = t.y + u0 * c, yb = t.y + u1 * c, za = zRoof + MT.lowerEdge + u0 * s, zb = zRoof + MT.lowerEdge + u1 * s;
        mods.push({ table: tid, array: a.id, block: a.block, row: r, col: k,
          corners: [[xa, ya, za], [xb, ya, za], [xb, yb, zb], [xa, yb, zb]],          // SW, SE, NE, NW (top glass)
          center: [(xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2] });
      }
    });
  }
  return { mods, tables };
}
