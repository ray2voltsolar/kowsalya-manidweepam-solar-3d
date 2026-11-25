// Independent study geometry in plan coordinates (metres). All supplied solid footprints are convex.
const EPS = 1e-9;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const rect = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export function prism(id, kind, ring, z0, z1) {
  const x = ring.map(p => p[0]), y = ring.map(p => p[1]);
  const x0 = Math.min(...x), x1 = Math.max(...x), y0 = Math.min(...y), y1 = Math.max(...y);
  const ccw = ring.reduce((a, p, i) => a + cross(...p, ...ring[(i + 1) % ring.length]), 0) > 0;
  const points = ccw ? ring : [...ring].reverse();
  const planes = points.map(([x, y], i) => {
    const [u, v] = points[(i + 1) % points.length];
    return [y - v, u - x, (y - v) * x + (u - x) * y];
  });
  for (const [a, b, c] of planes) {
    if (points.some(([x, y]) => a * x + b * y < c - EPS)) throw Error('Nonconvex prism: ' + id);
  }
  const box = ring.length === 4 && ring.every(([x, y]) => (x === x0 || x === x1) && (y === y0 || y === y1));
  const lower = points.map(([x, y]) => [x, y, z0]), upper = points.map(([x, y]) => [x, y, z1]);
  const edges = points.flatMap((_, i) => {
    const j = (i + 1) % points.length;
    return [[lower[i], lower[j]], [upper[i], upper[j]], [lower[i], upper[i]]];
  });
  return { id, kind, x0, x1, y0, y1, z0, z1, shape: box ? 'box' : 'prism', planes, edges };
}

export function tableQuad(t) {
  const { x0, x1, ySouth: y0, yNorth: y1, zLow: z0, zHigh: z1 } = t;
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]];
  return {
    id: t.id, kind: 'table', shape: 'quad', x0, x1, y0, y1, z0, z1, slope: (z1 - z0) / (y1 - y0),
    edges: p.map((a, i) => [a, p[(i + 1) % 4]])
  };
}

export function siteOccluders(site) {
  const objects = site.TABLES.map(tableQuad);
  for (const o of site.OBSTACLES) {
    objects.push(prism(o.id, 'roof-furniture', rect(o.x0, o.x1, o.y0, o.y1), o.z0, o.zTop));
    if (o.tank) {
      // assumed: tank bank occupies the central 70% of both dimensions and rises 1.7 m.
      const dx = 0.15 * (o.x1 - o.x0), dy = 0.15 * (o.y1 - o.y0);
      objects.push(prism(o.id + '/tank', 'roof-furniture', rect(o.x0 + dx, o.x1 - dx, o.y0 + dy, o.y1 - dy), o.zTop, o.zTop + 1.7));
    }
  }
  const { thickness: w, height: h } = site.BUILDING.parapet, z = site.BUILDING.roofZ;
  for (const poly of site.ROOF.polygons) {
    for (const ring of [poly.outer, ...poly.holes]) {
      // Slab lies on the left of CCW exteriors and CW wells, including short diagonal trace edges.
      const offsets = ring.map(([x, y], i) => {
        const [u, v] = ring[(i + 1) % ring.length], len = Math.hypot(u - x, v - y);
        return [(y - v) * w / len, (u - x) * w / len];
      });
      ring.forEach(([x, y], i) => {
        const j = (i + 1) % ring.length, [u, v] = ring[j], [a, b] = offsets[i], [c, d] = offsets[j];
        const wall = p => objects.push(prism('parapet', 'parapet', p, z, z + h));
        wall([[x, y], [u, v], [u + a, v + b], [x + a, y + b]]);
        if (cross(a, b, c, d) < -EPS) {
          // On a re-entrant corner the two strips leave a gap. Join their inside offset lines.
          const factor = w * w / (w * w + a * c + b * d);
          wall([[u, v], [u + a, v + b], [u + (a + c) * factor, v + (b + d) * factor], [u + c, v + d]]);
        }
      });
    }
  }
  for (const n of site.NEIGHBOURS) objects.push(prism(n.id, 'neighbour', n.polygon, 0, n.h));
  return objects;
}

// Exact entry distance along a sunward unit ray. Parallel slab directions are handled explicitly.
export function hitDistance(o, x, y, z, dir) {
  const [dx, dy, dz] = dir;
  if (o.shape === 'quad') {
    const denom = dz - o.slope * dy;
    if (Math.abs(denom) < EPS) return Infinity;
    const t = (o.z0 + o.slope * (y - o.y0) - z) / denom;
    if (t <= EPS) return Infinity;
    const u = x + t * dx, v = y + t * dy;
    return u >= o.x0 && u <= o.x1 && v >= o.y0 && v <= o.y1 ? t : Infinity;
  }
  let lo = Math.max(0, (o.z0 - z) / dz), hi = (o.z1 - z) / dz;
  if (hi < lo || hi <= EPS) return Infinity;
  if (o.shape === 'box') {
    if (dx === 0) { if (x < o.x0 || x > o.x1) return Infinity; }
    else {
      const a = (o.x0 - x) / dx, b = (o.x1 - x) / dx;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
    if (dy === 0) { if (y < o.y0 || y > o.y1) return Infinity; }
    else {
      const a = (o.y0 - y) / dy, b = (o.y1 - y) / dy;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
  } else {
    for (const [a, b, c] of o.planes) {
      const rate = a * dx + b * dy, gap = c - a * x - b * y;
      if (Math.abs(rate) < EPS) { if (gap > EPS) return Infinity; }
      else if (rate > 0) lo = Math.max(lo, gap / rate);
      else hi = Math.min(hi, gap / rate);
      if (hi < lo) return Infinity;
    }
  }
  return hi >= lo && hi > EPS ? lo : Infinity;
}

export function receiver(m, nu, nv) {
  const [x0, y0, z0] = m.corners[0], [x1, y1, z1] = m.corners[2];
  const samples = new Float64Array(nu * nv * 3);
  let i = 0;
  for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
    samples[i++] = x0 + (x1 - x0) * (u + 0.5) / nu;
    samples[i++] = y0 + (y1 - y0) * (v + 0.5) / nv;
    samples[i++] = z0 + (z1 - z0) * (v + 0.5) / nv;
  }
  return { id: m.id, block: m.block, table: m.table, x0, x1, y0, y1, z0, z1, slope: (z1 - z0) / (y1 - y0), samples };
}

const overlaps = (a, b) => a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1;

// Project each occluder's bounding box across the receiver height range, then cull by table and module.
export function makeTracer(receivers, objects) {
  const groups = new Map();
  for (const m of receivers) {
    if (!groups.has(m.table)) groups.set(m.table, []);
    groups.get(m.table).push(m);
  }
  const batches = Array.from(groups, ([id, modules]) => ({
    id, modules,
    x0: Math.min(...modules.map(m => m.x0)), x1: Math.max(...modules.map(m => m.x1)),
    y0: Math.min(...modules.map(m => m.y0)), y1: Math.max(...modules.map(m => m.y1))
  }));
  const zMin = Math.min(...receivers.map(m => m.z0)), zMax = Math.max(...receivers.map(m => m.z1));
  const potential = objects.filter(o => o.z1 >= zMin);
  return (dir, visit) => {
    const projected = potential.map(o => {
      const lo = Math.max(0, (o.z0 - zMax) / dir[2]), hi = (o.z1 - zMin) / dir[2];
      const ax = -dir[0] * lo, bx = -dir[0] * hi, ay = -dir[1] * lo, by = -dir[1] * hi;
      return { o, x0: o.x0 + Math.min(ax, bx), x1: o.x1 + Math.max(ax, bx), y0: o.y0 + Math.min(ay, by), y1: o.y1 + Math.max(ay, by) };
    });
    for (const batch of batches) {
      const near = projected.filter(b => b.o.id !== batch.id && overlaps(batch, b));
      if (!near.length) continue;
      for (const m of batch.modules) {
        const candidates = near.filter(b => b.o.z1 >= m.z0 && overlaps(m, b)).map(b => b.o);
        if (candidates.length) visit(m, candidates);
      }
    }
  };
}

export function traceSamples(m, candidates, dir, onHit) {
  let hits = 0;
  for (let i = 0; i < m.samples.length; i += 3) {
    const x = m.samples[i], y = m.samples[i + 1], z = m.samples[i + 2];
    let first = null, distance = Infinity;
    for (const o of candidates) {
      const t = hitDistance(o, x, y, z, dir);
      if (t < distance) { first = o; distance = t; }
    }
    if (first) { hits++; if (onHit) onHit(first); }
  }
  return hits / (m.samples.length / 3);
}

// For a strict clearance check, project the sunward part of a convex obstacle onto the actual glass.
// Clipping first prevents objects below the tilted receiver plane from casting backwards shadows.
function hull(points) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  function half(points) {
    const out = [];
    for (const p of points) {
      while (out.length >= 2) {
        const a = out.at(-2), b = out.at(-1);
        if (cross(b[0] - a[0], b[1] - a[1], p[0] - b[0], p[1] - b[1]) > EPS) break;
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  }
  return half(sorted).concat(half([...sorted].reverse()));
}

export function shadowPolygon(m, o, dir) {
  const dist = p => p[2] - m.z0 - m.slope * (p[1] - m.y0);
  const denom = dir[2] - m.slope * dir[1], vertices = [];
  if (denom <= EPS) return [];
  function project(p, d) { vertices.push([p[0] - dir[0] * d / denom, p[1] - dir[1] * d / denom]); }
  for (const [p, q] of o.edges) {
    const a = dist(p), b = dist(q);
    if (a > EPS) project(p, a);
    if (b > EPS) project(q, b);
    if ((a > EPS) !== (b > EPS)) {
      const f = a / (a - b);
      vertices.push([p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])]);
    }
  }
  let poly = hull(vertices);
  for (const [axis, limit, sign] of [[0, m.x0, 1], [0, m.x1, -1], [1, m.y0, 1], [1, m.y1, -1]]) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const a = sign * (p[axis] - limit), b = sign * (q[axis] - limit);
      if (a >= 0) out.push(p);
      if ((a >= 0) !== (b >= 0)) {
        const f = a / (a - b);
        out.push([p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])]);
      }
    }
    poly = out;
  }
  return poly.length >= 3 ? poly : [];
}

export function area(poly) {
  if (poly.length < 3) return 0;
  const [x, y] = poly[0];
  return Math.abs(poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length]; return s + cross(p[0] - x, p[1] - y, q[0] - x, q[1] - y);
  }, 0)) / 2;
}

// Between vertex and edge-intersection x coordinates, union height is linear. Midpoint integration is exact.
export function unionArea(polys) {
  if (polys.length < 2) return polys.length ? area(polys[0]) : 0;
  const edges = polys.map(poly => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]));
  const cuts = polys.flat().map(p => p[0]);
  for (let i = 0; i < edges.length; i++) for (let j = 0; j < i; j++) {
    for (const [a, b] of edges[i]) for (const [c, d] of edges[j]) {
      const u = b[0] - a[0], v = b[1] - a[1], w = d[0] - c[0], z = d[1] - c[1], det = cross(u, v, w, z);
      if (Math.abs(det) < EPS) continue;
      const t = cross(c[0] - a[0], c[1] - a[1], w, z) / det, s = cross(c[0] - a[0], c[1] - a[1], u, v) / det;
      if (t > 0 && t < 1 && s > 0 && s < 1) cuts.push(a[0] + u * t);
    }
  }
  cuts.sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < cuts.length; i++) {
    const dx = cuts[i] - cuts[i - 1];
    if (dx < EPS) continue;
    const x = cuts[i] - dx / 2, spans = [];
    for (const polyEdges of edges) {
      const ys = [];
      for (const [p, q] of polyEdges) if ((p[0] > x) !== (q[0] > x)) ys.push(p[1] + (x - p[0]) * (q[1] - p[1]) / (q[0] - p[0]));
      if (ys.length) spans.push([Math.min(...ys), Math.max(...ys)]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let end = -Infinity;
    for (const [a, b] of spans) { total += dx * Math.max(0, b - Math.max(a, end)); end = Math.max(b, end); }
  }
  return total;
}
