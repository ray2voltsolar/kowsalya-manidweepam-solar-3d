// ============================================================================
//  SOLAR — procedural textures (canvas). All generated at runtime.
// ============================================================================
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
// deterministic PRNG
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function tex(c, srgb, aniso, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso || 1;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

// Both faces use identical wafer coordinates so the clear encapsulant lines up.
function waferTexture(height, aniso, mod, rear) {
  const width = height / 2;
  const [c, g] = canvas(width, height);
  const R = rng(7);
  const w = (mod.width - 0.004) * 1000, h = (mod.length - 0.004) * 1000;
  g.scale(width / w, height / h);
  const { cellCols: cols, cellRows: rows } = mod;
  const half = rows / 2;
  const cw = mod.key === 'M700' ? 210 : 182, ch = 104.6; // assumed active wafer dimensions in mm
  const gap = 1.8, split = 12; // assumed encapsulant clearances
  const x0 = (w - cols*cw - (cols-1)*gap) / 2;
  const y0 = (h - rows*ch - (rows-2)*gap - split) / 2;
  const halfHeight = half*ch + (half-1)*gap;

  // Alpha stores coverage. Keep a dark filtered colour in subpixel glass lanes.
  g.fillStyle = 'rgba(43,49,52,0.27)';
  g.fillRect(0,0,w,h);
  const cells = new Path2D(), fingers = new Path2D();
  for (let r = 0; r < rows; r++) {
    const y = y0 + r*(ch+gap) + (r >= half ? split-gap : 0);
    for (let col = 0; col < cols; col++) {
      const x = x0 + col*(cw+gap), k = Math.round((R()-0.5)*4);
      g.fillStyle = rear ? `rgb(${26+k},${30+k},${34+k})` : `rgb(${13+k},${18+k},${26+k})`;
      g.fillRect(x,y,cw,ch);
      cells.rect(x,y,cw,ch);
    }
    // One clipped screen print across the row. Subpixel coverage is integrated
    // by the canvas rasterizer and the same trilinear mip chain as the busbars.
    for (let f=1; f<50; f++) fingers.rect(x0,y+ch*f/50,w-2*x0,0.20);
  }
  g.save(); g.clip(cells);
  g.fillStyle = rear ? 'rgba(145,148,147,0.065)' : 'rgba(123,132,143,0.045)';
  g.fill(fingers); g.restore();
  for (let side = 0; side < 2; side++) {
    const y = y0 + side*(halfHeight+split);
    for (let col = 0; col < cols; col++) {
      const x = x0 + col*(cw+gap);
      g.fillStyle = rear ? 'rgba(156,157,154,0.60)' : 'rgba(151,157,159,0.40)';
      for (let b = 0; b < 16; b++) g.fillRect(x+(b+0.5)*cw/16,y-1,0.48,halfHeight+2);
    }
    // Three paired ribbons terminate behind the split boxes. Breaks between
    // circuits and the clear strip between halves stay visible at close range.
    const centreY = side ? y-2.3 : y+halfHeight+0.7;
    g.fillStyle = 'rgb(97,101,101)';
    for (let pair=0; pair<3; pair++) g.fillRect(x0+pair*2*(cw+gap)+4,centreY,2*cw+gap-8,1.6);
  }
  if (rear) {
    // Assumed unbranded rating label mounted beside the middle junction box.
    g.translate(w/2+149,h/2+18); g.scale(-1,1);
    g.fillStyle = '#c9c9c1'; g.fillRect(0,0,93,42);
    g.fillStyle = '#393c3c'; g.font = 'bold 8px sans-serif';
    g.fillText(mod.wp+' Wp',5,10); g.font = '4px sans-serif';
    g.fillText('BIFACIAL PV MODULE',5,18);
    g.fillText('Voc '+mod.voc+' V    Isc '+mod.isc+' A',5,25);
    for (let j=0; j<31; j++) g.fillRect(5+j*2.2,31,0.65+((j*7)%3)*0.4,6);
  }
  return tex(c,true,aniso);
}

export const makeCellTexture = (height,aniso,mod) => waferTexture(height,aniso,mod,false);
export const makeBackTexture = (height,aniso,mod) => waferTexture(height,aniso,mod,true);

/** Galvanised steel (hot-dip spangle + dust), tileable. */
export function makeGalvTexture(size = 256, seed = 3, base = [168, 172, 172], patternSize = size) {
  const [c, g] = canvas(size, size); const R = rng(seed);
  g.scale(size/patternSize,size/patternSize);
  g.fillStyle = `rgb(${base.join(',')})`; g.fillRect(0, 0, patternSize, patternSize);
  // spangle flakes
  for (let i = 0; i < patternSize * 1.2; i++) {
    const x = R() * patternSize, y = R() * patternSize, r = 3 + R() * patternSize / 14, v = (R() - 0.5) * 26;
    g.fillStyle = `rgba(${base[0] + v},${base[1] + v},${base[2] + v + 2},0.35)`;
    g.beginPath();
    const n = 5 + (R() * 3 | 0); for (let k = 0; k < n; k++) { const a = k / n * 6.283 + R() * 0.6, rr = r * (0.6 + R() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  }
  // dust / white-rust blotches
  for (let i = 0; i < 40; i++) {
    const x = R() * patternSize, y = R() * patternSize, r = 6 + R() * patternSize / 6;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${150 + R() * 30},${140 + R() * 25},${118},0.18)`); gr.addColorStop(1, 'rgba(150,140,118,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return tex(c, true, 1, true);
}

/** Mould-cast concrete with aggregate, mottling and air pores. */
export function makeConcreteTexture(size = 256, seed = 5, patternSize = size) {
  const [c, g] = canvas(size, size); const R = rng(seed);
  g.scale(size/patternSize,size/patternSize);
  g.fillStyle = '#a19c92'; g.fillRect(0, 0, patternSize, patternSize);
  for (let i = 0; i < 2500; i++) {
    const v = 120 + R() * 70; g.fillStyle = `rgba(${v},${v - 4},${v - 12},0.25)`;
    const s = 1 + R() * 3; g.fillRect(R() * patternSize, R() * patternSize, s, s);
  }
  for (let i = 0; i < 18; i++) {
    const x = R() * patternSize, y = R() * patternSize, r = 10 + R() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${90 + R() * 30},${80 + R() * 25},62,0.12)`); gr.addColorStop(1, "rgba(90,80,62,0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const grain = g.getImageData(0,0,size,size);
  for (let i=0; i<grain.data.length; i+=4) {
    const change = (R()-0.5)*17;
    for (let k=0;k<3;k++) grain.data[i+k] += change;
  }
  g.putImageData(grain,0,0);
  for (let i=0; i<patternSize/2; i++) {
    const x=R()*patternSize,y=R()*patternSize,r=(0.001+R()*0.0035)*patternSize;
    g.fillStyle='rgba(222,218,201,0.35)'; g.beginPath(); g.arc(x,y+r*0.45,r,0,Math.PI*2); g.fill();
    g.fillStyle='rgba(83,80,74,0.48)'; g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.fill();
  }
  // Assumed faded precaster identification, low on the mould face.
  g.fillStyle='rgba(83,79,70,0.48)';
  g.font='bold '+Math.round(patternSize*0.072)+'px monospace';
  g.fillText('PC',patternSize*0.73,patternSize*0.81);
  return tex(c, true, 1, true);
}
