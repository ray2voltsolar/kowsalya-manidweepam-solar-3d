// ============================================================================
//  SOLAR — PV module geometry (local frame: X = u (width), Y = normal, Z = -v
//  i.e. +Z points DOWN-slope; origin = centre of the top glass surface).
// ============================================================================
import * as THREE from 'three';
import { GB, sweepRect, rod } from './geom.js';

export const GLASS_INSET = 0.002;
export const GLASS_THICK = 0.0065;

/** laminate: group 0 = front glass (cells), group 1 = back glass */
export function laminateGeometry(MOD) {
  const hw = MOD.width / 2 - GLASS_INSET, hl = MOD.length / 2 - GLASS_INSET;
  const gb = new GB();
  const up = new THREE.Vector3(0, 1, 0), dn = new THREE.Vector3(0, -1, 0);
  // uv.y = 0 at +Z (down-slope edge)
  gb.group(0).quad(new THREE.Vector3(-hw, 0, hl), new THREE.Vector3(hw, 0, hl), new THREE.Vector3(hw, 0, -hl), new THREE.Vector3(-hw, 0, -hl), up,
    [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const bw = hw, bl = hl, y = -GLASS_THICK;
  gb.group(1).quad(new THREE.Vector3(-bw, y, bl), new THREE.Vector3(bw, y, bl), new THREE.Vector3(bw, y, -bl), new THREE.Vector3(-bw, y, -bl), dn,
    [[0, 0], [1, 0], [1, 1], [0, 1]]);
  return gb.build();
}

export function frameGeometry(mod, quality) {
  const gb = new GB();
  const bottom = -mod.thickness + 0.002;
  const flange = mod.frame.width;
  // assumed extrusion: 11 mm sightline, 2 mm proud lip and inward bottom return.
  const profile = [[0, 0.002], [0, bottom], [flange, bottom],
    [flange, bottom + 0.002], [0.003, bottom + 0.002], [0.003, -GLASS_THICK],
    [0.011, -GLASS_THICK], [0.011, 0.0012], [0.0103, 0.002]];
  const simple = [[0, 0.002], [0, bottom], [flange, bottom], [0.011, 0.002]];
  sweepRect(gb, quality === 'low' ? simple : profile, mod.width / 2, mod.length / 2);
  return gb.build();
}

export function backDetailGeometry(mod, quality) {
  const gb = new GB();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const y = -GLASS_THICK;
  const spacing = mod.width / 3;
  // Leave out surfaces against the glass or between the housing and its lid.
  function housing(x, depth, width, height, length, visibleBottom) {
    const box = new THREE.BoxGeometry(width,height,length);
    const faces = box.groups.filter(g => g.materialIndex !== 2 && (visibleBottom || g.materialIndex !== 3));
    const index = box.index.array;
    box.setIndex(faces.flatMap(g => Array.from(index.slice(g.start,g.start+g.count))));
    gb.add(box,new THREE.Matrix4().makeTranslation(x,y-depth,0));
  }
  for (const x of [-spacing, 0, spacing]) {
    // assumed split diode housings, 86 x 56 mm; the lid has a wider moulded rim.
    housing(x,0.009,0.086,0.018,0.056,quality === 'low');
    if (quality !== 'low') housing(x,0.019,0.090,0.004,0.060,true);
  }
  for (const side of [-1, 1]) {
    // assumed clipped 6 mm PV leads with modest slack, connector parked at the frame.
    const outer = side * (mod.width / 2 - 0.022);
    const pts = [V(side * spacing, y - 0.011, side * 0.026),
      V(side * (spacing + 0.019), -0.065, side * 0.11),
      V(side * (spacing + 0.09), -0.080, side * 0.23), V(outer, -0.035, side * 0.33)];
    const segments = quality === 'high' ? 5 : quality === 'medium' ? 4 : 2;
    gb.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segments, 0.0032, quality === 'low' ? 3 : 4, false));
    rod(gb, pts[3], V(outer, -0.035, side * 0.395), 0.008, quality === 'low' ? 3 : 6, quality !== 'low');
  }
  return gb.build();
}
