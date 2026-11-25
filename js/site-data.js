// ============================================================================
//  SITE DATA — the single source of truth for the 3D model.
//  Kowsalya Manidweepam Cultural Community, Bachupally, Hyderabad — rooftop PV
// ----------------------------------------------------------------------------
//  PLAN COORDINATES (used everywhere in this file):
//    x = East (m), y = North (m), z = Up (m) above finished ground level.
//    Origin = reference point SITE.originGeo (centre of the complex).
//  THREE.JS WORLD:  X = East, Y = Up, Z = South   (North = -Z)
//    -> use planToWorld(THREE, x, y, z)  ==  new THREE.Vector3(x, z, -y)
//
//  Where the numbers come from
//    * Roof outline, ducts, courtyards: traced from Esri World Imagery (WorldView-3, 15 Feb 2026,
//      0.31 m) — see roof-data.js / tools/build_roof_data.py. Precision about +-0.75 m per edge.
//    * Roof furniture (head-rooms, tanks, louvre screens, vent boxes): positions read off the same
//      imagery; HEIGHTS ARE ASSUMED. Verify on site.
//    * Storeys: stilt/ground + 5 floors counted on street-level imagery; 3.0 m per floor assumed.
//    * PV layout: tools/build-layout.mjs (layout-solver.js) -> layout-data.js.
//  Pure data + pure maths: NO three.js import, so this also runs under Node.
// ============================================================================
import { CONFIG, MODULE_PRESETS, MOUNTING_PRESETS } from './config.js';
import { ROOF_POLYGONS, ROOF_OBSTACLES_RAW, NEIGHBOURS_RAW, ROOF_TRACE_META } from './roof-data.js';
import { LAYOUTS, CAPACITY_STUDY, PVGIS_DATA, BUILD_INFO } from './layout-data.js';

export { CONFIG, MODULE_PRESETS, MOUNTING_PRESETS, ROOF_TRACE_META, CAPACITY_STUDY, BUILD_INFO };

// ---------------------------------------------------------------------------
// Project / location
// ---------------------------------------------------------------------------
export const PROJECT = {
  customer: 'Kowsalya Manidweepam Cultural Community',
  businessType: 'Residential apartment community',
  address: 'Nizampet Main Road, Bachupally, Hyderabad, Telangana 500090',
  plusCode: 'G9M8+65 Hyderabad',
  preparedBy: 'Ray2Volt Solar',
  systemLabel: '', // filled below from the active layout
};

export const SITE = {
  lat: 17.5341, lng: 78.3663, utcOffsetHours: 5.5,
  // Geographic position of the plan origin.
  originGeo: { lat: 17.534112606887494, lng: 78.36629404814755 },
  // Fine alignment of the satellite ground texture vs the model, metres (+x east, +y north).
  imageryOffset: { x: 0, y: 0 },
  // The Esri scene looks ~20 deg off-nadir from the north: roof-level features appear this far from their true
  // plan position on the texture. The model is in true plan; the stale roof image under/around the buildings
  // must therefore be hidden by the procedural compound ground (see COMPOUND).
  imageryRoofLean: { x: 0.25, y: -6.5 },
  center: { x: -18, y: -32 },          // middle of the complex
  detailBounds: { minX: -130, maxX: 90, minY: -150, maxY: 110 },
};

// ---------------------------------------------------------------------------
// Helpers (pure maths)
// ---------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / len(a));
export const vec = { sub, add, mul, dot, cross, len, norm };
export function planToWorldArray(x, y, z = 0) { return [x, z, -y]; }
export function planToWorld(THREE, x, y, z = 0) { return new THREE.Vector3(x, z, -y); }

export function ringArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// BUILDING — one connected RCC apartment complex (stilt + 5), three wings.
// ---------------------------------------------------------------------------
export const BUILDING = {
  name: 'Kowsalya Manidweepam', floors: CONFIG.floors, floorHeight: CONFIG.floorHeight,
  stiltHeight: 3.0,                                   // ground level: parking stilt + entrance lobbies
  roofZ: CONFIG.floors * CONFIG.floorHeight,          // terrace finish level above ground = 18.0 m
  slabThickness: 0.15,
  parapet: { height: CONFIG.parapetHeight, thickness: CONFIG.parapetThickness },
  heightConfidence: 'medium: 6 storeys counted on street-level imagery; 3.0 m floor height assumed (+-1.5 m overall)',
  // Facade character (street-level imagery): warm light-grey plaster with white horizontal bands and balcony
  // slabs, dark grey tile accent panels, glass balcony railings, tan vertical-louvre screens at terrace level.
  facade: { wall: '#cfc9bf', band: '#f2f0ea', accent: '#5b5d61', louvre: '#b89a6a', glass: '#8fb0bf', stilt: '#b9b4aa' },
};

/** Terrace slab outline(s): [{id, outer:[[x,y]..] (CCW), holes:[[[x,y]..] (CW)..]}]. Holes = open ducts / courtyards. */
export const ROOF = {
  polygons: ROOF_POLYGONS,
  z: BUILDING.roofZ,
  grossAreaM2: ROOF_POLYGONS.reduce((s, p) => s + Math.abs(ringArea(p.outer)) - p.holes.reduce((t, h) => t + Math.abs(ringArea(h)), 0), 0),
};

/** Wings used for reporting and camera presets. */
export const BLOCKS = {
  A: { id: 'A', name: 'Block A · West wing', short: 'West wing', bounds: { x0: -70.5, x1: -25.0, y0: -58.5, y1: 22.5 }, color: '#2f7fd0' },
  B: { id: 'B', name: 'Block B · East wing', short: 'East wing', bounds: { x0: -25.0, x1: 38.5, y0: -58.5, y1: 34.5 }, color: '#2fa36b' },
  C: { id: 'C', name: 'Block C · South wing', short: 'South wing', bounds: { x0: -70.5, x1: -4.0, y0: -97.5, y1: -58.5 }, color: '#d98a1f' },
};
export function blockOf(x, y) { if (y < -58.5) return 'C'; return x < -25.0 ? 'A' : 'B'; }

/** Roof furniture. Box footprints in plan, h = height above the terrace finish (ASSUMED heights).
 *  type: headroom (stair head-room) | lmr (lift machine room) | tank | screen (louvre screen wall) | vent | shed */
export const OBSTACLES = ROOF_OBSTACLES_RAW.map((o) => ({ ...o, block: blockOf((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2), z0: BUILDING.roofZ, zTop: BUILDING.roofZ + o.h }));

/** Surrounding buildings as plain massing: [{id, polygon:[[x,y]..], h, kind, note}] */
export const NEIGHBOURS = NEIGHBOURS_RAW;

// Ground-level context read off the satellite (ground features need no lean correction).
export const COMPOUND = {
  // property boundary (approximate), counter-clockwise; inside it the ground is procedural paving / landscape
  polygon: [[-80, -112], [-6, -112], [-2, -98], [5, -68], [11, -54], [18, -41], [24, -30], [31, -20], [40, -12], [56, -8], [58, 22], [38, 26], [10, 40], [-24, 42], [-28, 24], [-80, 24]],
  wallHeight: 2.1,
  gate: { x: -80, y: -106, width: 7, facing: 'W', note: 'entrance at the south-west corner on Nizampet Main Road (map pin)' },
  driveway: [[-80, -112], [-6, -112], [-6, -99], [-80, -99]],            // paved strip along the south side
  treeBelt: { x0: -79, x1: -71.5, y0: -96, y1: 20, note: 'row of avenue trees between the compound wall and the west facade' },
  pool: { x0: 41.6, x1: 52.4, y0: 2.0, y1: 13.4, onRoofOf: 'N-CLUB' },
};
export const ROAD = {
  name: 'Nizampet Main Road', width: 10,
  centerline: [[-146.9, 201.3], [-122.7, 155.7], [-102.8, 104.5], [-90.8, 53.2], [-88.6, 13.4], [-87.5, -43.6], [-86.5, -100.5], [-83.0, -157.5], [-79.0, -224.6]],
};
export const SURROUNDINGS = {
  note: 'South and east of the site are open scrub / a seasonal stream bed; low-rise villas lie south-west across the road. Nothing taller than the complex stands to its south, east or west within 60 m.',
  scrubEast: true,
};

// ---------------------------------------------------------------------------
// ACTIVE DESIGN VARIANT  (module preset x mounting preset)
// ---------------------------------------------------------------------------
function pickVariant() {
  let m = CONFIG.modulePreset, t = CONFIG.mountingPreset;
  try {
    const q = new URLSearchParams(globalThis.location ? globalThis.location.search : '');
    if (q.get('module') && MODULE_PRESETS[q.get('module')]) m = q.get('module');
    if (q.get('mount') && MOUNTING_PRESETS[q.get('mount')]) t = q.get('mount');
  } catch (e) { /* node */ }
  return { m, t, key: `${m}|${t}` };
}
export const VARIANT = pickVariant();
export const MODULE = { ...MODULE_PRESETS[VARIANT.m], make: '', model: MODULE_PRESETS[VARIANT.m].label,
  frame: { width: MODULE_PRESETS[VARIANT.m].frameWidth, color: '#c9ccd0' } };
export const MOUNTING = { ...MOUNTING_PRESETS[VARIANT.t], gap: 0.020, tiltDeg: CONFIG.tiltDeg, azimuthDeg: CONFIG.azimuthDeg };
export const LAYOUT = LAYOUTS[VARIANT.key];
export const VARIANT_KEYS = Object.keys(LAYOUTS);

/**
 * Structural tables of the active layout:
 * [{id, array, block, x0, x1, ySouth, yNorth, zLow, zHigh, cols, rows, slopeLen}]  (z above ground, top-glass plane)
 * A table is `rows` portrait modules up the slope by `cols` modules along the row; it faces due south at CONFIG.tiltDeg.
 */
export const TABLES = LAYOUT.tables;

const TILT = CONFIG.tiltDeg * Math.PI / 180;
/** Unit vectors of every module plane (all tables share them): u = east along the row, v = up-slope (north + up), n = normal. */
export const ARRAY_AXES = { u: [1, 0, 0], v: [0, Math.cos(TILT), Math.sin(TILT)], n: [0, -Math.sin(TILT), Math.cos(TILT)] };

let _modules = null;
/**
 * Every PV module of the active layout:
 * { index, id, table, array, block, plane (= block), row, col, corners:[SW,SE,NE,NW] top-glass corners (plan xyz),
 *   center:[x,y,z], u, v, n, string:'S01'.., stringIndex, inverter:'INV-1'.., tiltDeg, azimuthDeg, wp }
 */
export function computeLayout() {
  if (_modules) return _modules;
  const gx = 0.02, gs = 0.02, c = Math.cos(TILT), s = Math.sin(TILT), M = MODULE; const out = [];
  for (const t of TABLES) {
    for (let r = 0; r < t.rows; r++) for (let k = 0; k < t.cols; k++) {
      const xa = t.x0 + k * (M.width + gx), xb = xa + M.width, u0 = r * (M.length + gs), u1 = u0 + M.length;
      const ya = t.ySouth + u0 * c, yb = t.ySouth + u1 * c, za = t.zLow + u0 * s, zb = t.zLow + u1 * s;
      out.push({ table: t.id, array: t.array, block: t.block, plane: t.block, row: r, col: k,
        corners: [[xa, ya, za], [xb, ya, za], [xb, yb, zb], [xa, yb, zb]], center: [(xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2],
        u: ARRAY_AXES.u, v: ARRAY_AXES.v, n: ARRAY_AXES.n, tiltDeg: CONFIG.tiltDeg, azimuthDeg: CONFIG.azimuthDeg, wp: M.wp });
    }
  }
  // electrical assignment comes from the generated layout (same module order: table order, row, col)
  const sa = LAYOUT.stringOfModule;
  out.forEach((m, i) => { m.index = i; m.id = `M${String(i + 1).padStart(3, '0')}`; m.stringIndex = sa[i]; m.string = STRINGS[sa[i]].id; m.inverter = STRINGS[sa[i]].inverter; });
  _modules = out; return out;
}

// ---------------------------------------------------------------------------
// ELECTRICAL
// ---------------------------------------------------------------------------
/** [{id:'S01', index, inverter:'INV-1', modules:n, block}] */
export const STRINGS = LAYOUT.strings;
/** [{id:'INV-1', kw, station:'ST-1', strings:n, modules:n, dcKwp}] */
export const INVERTERS = LAYOUT.inverters;
/** Wall-mounted inverter stations on a head-room wall that has 1.8 m of clear terrace in front (chosen by
 *  tools/build-layout.mjs; north walls preferred, then east).
 *  [{id, obstacle (OBSTACLES id), wall:'N'|'S'|'E'|'W', normal:[nx,ny], inverters:[ids], x, y (centre of the wall face, plan), z, block, width, frontClearM}] */
export const INVERTER_STATIONS = LAYOUT.stations;
/** AC evacuation: ladder from each station to the riser point (inside the open courtyard nearest to ST-1) and down its wall to the LT panel at ground level (panel location assumed). */
export const AC_RISER = LAYOUT.acRiser;

export const STRING_COLORS = ['#e6194b', '#ffe119', '#f58231', '#d6249f', '#ffb000', '#8c2d04', '#1f6fff', '#46e6f0', '#2fb84a', '#8a3ffc',
  '#00a6a6', '#b8d200', '#ff6f91', '#7b5cff', '#00c2ff', '#ff9e44', '#59c36a', '#c44dff', '#f2c230', '#3d8bfd',
  '#e2547a', '#1fb5a8', '#a3d14a', '#ff7f50', '#6a8dff', '#d9a441', '#3fc1c9', '#e86af0', '#8fd14f', '#ff5c5c',
  '#4dabf7', '#f4a261', '#9d79f2', '#2ec4b6', '#e9c46a', '#f28482', '#84a59d', '#577590', '#f94144', '#90be6d'];
export const INVERTER_COLORS = { 'INV-1': '#2f7fd0', 'INV-2': '#d98a1f', 'INV-3': '#2fa36b', 'INV-4': '#b04fc9' };

// ---------------------------------------------------------------------------
// ENERGY (PVGIS 5.3, PVGIS-ERA5) — per kWp for the array orientation
// ---------------------------------------------------------------------------
export const PVGIS = PVGIS_DATA;          // { S: { annual (kWh/kWp), monthly:[12], lossPct, slope, azimuth, source }, ... }
export const GRID_EMISSION_FACTOR = CONFIG.gridEmissionFactor;

export function systemSummary(modules = computeLayout()) {
  const n = modules.length, kwp = n * MODULE.wp / 1000;
  const perBlock = {};
  for (const b of Object.keys(BLOCKS)) perBlock[b] = { modules: 0, kwp: 0 };
  for (const m of modules) { perBlock[m.block].modules++; perBlock[m.block].kwp += MODULE.wp / 1000; }
  // HEADLINE = year-1 generation exactly as in the proposal: PVGIS at 16 % total system loss (near shading sits inside that
  // allowance), then 1 % first-year degradation. For the offered 450.45 kWp the printed proposal figures are used verbatim.
  const pv = PVGIS.S, deg = 1 - CONFIG.firstYearDegradationPct / 100;
  const PE = CONFIG.proposalEnergy && Math.abs(CONFIG.proposalEnergy.kwp - kwp) < 0.005 ? CONFIG.proposalEnergy : null;
  const annualBeforeDegradationKwh = PE ? PE.annualBeforeDegradationKwh : pv.annual * kwp;
  const annualKwh = PE ? PE.year1Kwh : pv.annual * kwp * deg;                      // year 1
  const monthlyKwh = PE ? PE.monthlyYear1Kwh.slice() : pv.monthly.map((e) => e * kwp * deg);
  const shadingLossPct = LAYOUT.shading && n === LAYOUT.modules ? LAYOUT.shading.electricalLossPct : null;
  const acKw = INVERTERS.reduce((s, v) => s + v.kw, 0);
  return { modules: n, kwp, perBlock, perPlane: perBlock, strings: STRINGS.length, inverters: INVERTERS.length, acKw, dcAcRatio: kwp / acKw,
    annualKwh, year1Kwh: annualKwh, annualBeforeDegradationKwh, monthlyKwh, specificYield: annualBeforeDegradationKwh / kwp, specificYieldYear1: annualKwh / kwp,
    systemLossPct: pv.lossPct, firstYearDegradationPct: CONFIG.firstYearDegradationPct, shadingLossPct, shadingInsideSystemLoss: true,
    // kept for callers written against the earlier field names
    annualKwhBeforeShading: annualBeforeDegradationKwh, specificYieldBeforeShading: annualBeforeDegradationKwh / kwp,
    co2TonnesPerYear: annualKwh * GRID_EMISSION_FACTOR / 1000,
    moduleAreaM2: n * MODULE.length * MODULE.width, tiltDeg: CONFIG.tiltDeg, azimuthDeg: CONFIG.azimuthDeg, variant: VARIANT.key };
}
PROJECT.systemLabel = `${(LAYOUT.modules * MODULE.wp / 1000).toFixed(2)} kWp Rooftop Solar PV`;

// ---------------------------------------------------------------------------
// LABELS (CSS2D) — plan position + text
// ---------------------------------------------------------------------------
export const LABELS = (() => {
  const s = LAYOUT.perBlock; const L = [];
  const anchor = { A: [-62, -35], B: [8, -22], C: [-40, -80] };
  for (const b of Object.keys(BLOCKS)) {
    const e = s[b] || { modules: 0, kwp: 0 };
    L.push({ id: `block-${b}`, kind: 'roof', x: anchor[b][0], y: anchor[b][1], z: BUILDING.roofZ + 6, title: BLOCKS[b].name, sub: `${e.modules} modules · ${e.kwp.toFixed(2)} kWp`, block: b });
  }
  for (const st of LAYOUT.stations) L.push({ id: st.id, kind: 'equipment', x: st.x, y: st.y, z: BUILDING.roofZ + 4.6, title: `Inverter station ${st.id.replace('ST-', '')}`, sub: `${st.inverters.length} × ${CONFIG.inverterKw} kW` });
  L.push({ id: 'road', kind: 'context', x: -88, y: -70, z: 1, title: ROAD.name, sub: '' });
  return L;
})();
