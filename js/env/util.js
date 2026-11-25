// ============================================================================
//  ENV utilities: seeded RNG, value noise, canvas helpers, geometry helpers.
// ============================================================================

/** Mulberry32 seeded RNG → function returning [0,1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 2D value noise (hash based, tileable when period given) ---------------
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);

export function valueNoise(x, y, seed = 0, period = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = fade(x - x0), fy = fade(y - y0);
  let xa = x0, xb = x0 + 1, ya = y0, yb = y0 + 1;
  if (period) { xa = ((xa % period) + period) % period; xb = ((xb % period) + period) % period; ya = ((ya % period) + period) % period; yb = ((yb % period) + period) % period; }
  const a = hash2(xa, ya, seed), b = hash2(xb, ya, seed), c = hash2(xa, yb, seed), d = hash2(xb, yb, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise in [0,1]. period (in base-frequency cells) makes it tileable. */
export function fbm(x, y, oct = 4, seed = 0, period = 0) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * valueNoise(x * f, y * f, seed + i * 17, period ? period * f : 0);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Distance from point to polyline [[x,y],...]. */
export function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const vx = bx - ax, vy = by - ay; const l2 = vx * vx + vy * vy;
    let t = l2 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const dx = ax + vx * t - x, dy = ay + vy * t - y; const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

/** Shader snippet: alpha boost with mip level so alpha-tested foliage does not thin out at distance. */
export const ALPHA_MIP_FIX = /* glsl */`
  float leafMip = 0.;
  #ifdef USE_MAP
  {
    vec2 _ts = vec2(textureSize(map, 0));
    vec2 _dx = dFdx(vMapUv * _ts), _dy = dFdy(vMapUv * _ts);
    float _mip = max(0.0, 0.5 * log2(max(dot(_dx, _dx), dot(_dy, _dy))));
    leafMip = _mip;
    diffuseColor.a *= 1.0 + _mip * 0.28;
  }
  #endif
`;

// The two sides of each leaf share a canopy normal, keeping sunlit crowns soft.
export function patchFoliage(mat) {
  mat.onBeforeCompile=sh=>{
    sh.fragmentShader=sh.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n'+ALPHA_MIP_FIX)
      .replace('#include <alphatest_fragment>', `
        #if defined(USE_ALPHATEST) && defined(ALPHA_TO_COVERAGE)
          // Centre the coverage ramp on the cutout. Once a whole leaflet is subpixel,
          // use its filtered silhouette to avoid a bright fringe across the crown.
          float edge=.5*clamp(fwidth(diffuseColor.a),.01,.30);
          float soft=smoothstep(alphaTest-edge,alphaTest+edge,diffuseColor.a);
          diffuseColor.a=mix(soft,step(alphaTest,diffuseColor.a),smoothstep(1.5,3.,leafMip));
          if(diffuseColor.a<=0.)discard;
        #else
          #include <alphatest_fragment>
        #endif
      `)
      .replace('#include <normal_fragment_begin>','float faceDirection=1.;vec3 normal=normalize(vNormal);vec3 nonPerturbedNormal=normal;');
  };
  return mat;
}

/** Indexed accumulator shared by the hand-built boughs, vehicles and kerbs. */

export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, uv, c = [1, 1, 1]) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
    this.c.push(c[0], c[1], c[2]);
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build(THREE, { color = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));

    const idx = this.count > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/**
 * Tapered tube along a polyline of points [[x,y,z],...] with radii [r,...].
 * vScale: metres per texture repeat along the tube.
 */
export function addTube(gb, pts, radii, radial = 8, vScale = 1, color = [1, 1, 1], capTop = false) {
  const n = pts.length; let len = 0; const rings = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(...t) || 1; t = t.map((v) => v / tl);
    let ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let s1 = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
    const sl = Math.hypot(...s1); s1 = s1.map((v) => v / sl);
    const s2 = [t[1] * s1[2] - t[2] * s1[1], t[2] * s1[0] - t[0] * s1[2], t[0] * s1[1] - t[1] * s1[0]];
    if (k > 0) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]);
    const ring = [];
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2; const ca = Math.cos(ang), sa = Math.sin(ang);
      const nrm = [s1[0] * ca + s2[0] * sa, s1[1] * ca + s2[1] * sa, s1[2] * ca + s2[2] * sa];
      const r = radii[k];
      const p = [pts[k][0] + nrm[0] * r, pts[k][1] + nrm[1] * r, pts[k][2] + nrm[2] * r];
      ring.push(gb.vert(p, nrm, [j / radial, len / vScale], typeof color === 'function' ? color(k / (n - 1)) : color));
    }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < radial; j++) {
    gb.quad(rings[k][j], rings[k][j + 1], rings[k + 1][j + 1], rings[k + 1][j]);
  }
  if (capTop) {
    const last = pts[n - 1]; const c = gb.vert(last, [0, 1, 0], [0.5, len / vScale], typeof color === 'function' ? color(1) : color);
    for (let j = 0; j < radial; j++) gb.tri(rings[n - 1][j], rings[n - 1][j + 1], c);
  }
}

// Preserve the straight-alpha colour of fine leaves as the canvas filters each mip.
export function canvasTexture(THREE, canvas) {
  const width=canvas.width, height=canvas.height, levels=[];
  let source=canvas;
  while(source) {
    const w=source.width,h=source.height;
    const pixels=source.getContext('2d').getImageData(0,0,w,h).data;
    levels.push({width:w,height:h,data:new Uint8Array(pixels.buffer)});
    let next=null;
    if(w>1 || h>1) {
      next=makeCanvas(Math.max(1,w>>1),Math.max(1,h>>1));
      next.getContext('2d').drawImage(source,0,0,next.width,next.height);
    }
    source.width=source.height=1;
    source=next;
  }
  const texture=new THREE.DataTexture(levels[0].data,width,height);
  texture.mipmaps=levels;texture.flipY=true;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.needsUpdate=true;
  return texture;
}

// Upload all levels explicitly. Some ANGLE backends return empty autogenerated mips
// for DOM uploads and packed data textures, exposing old imagery or losing fine grain.
export function completeMips(texture) {
  let level=texture.image;
  const levels=[level];
  while(level.width>1 || level.height>1){
    const width=Math.max(1,level.width>>1),height=Math.max(1,level.height>>1);
    if(texture.isDataTexture) {
      const data=new Uint8Array(width*height*4),src=level.data;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const left=Math.min(x*2,level.width-1),top=Math.min(y*2,level.height-1);
        const a=(top*level.width+left)*4,b=a+(left+1<level.width?4:0);
        const row=top+1<level.height?level.width*4:0,k=(y*width+x)*4;
        for(let c=0;c<4;c++)data[k+c]=(src[a+c]+src[b+c]+src[a+row+c]+src[b+row+c]+2)>>2;
      }
      level={width,height,data};
    } else {
      const canvas=makeCanvas(width,height);
      canvas.getContext('2d').drawImage(level,0,0,width,height);
      level=canvas;
    }
    levels.push(level);
  }
  texture.mipmaps=levels;texture.generateMipmaps=false;texture.needsUpdate=true;
  return texture;
}

// Explicit levels avoid blank autogenerated mips on some ANGLE backends.
export async function bitmapLevels(base) {
  const levels=[base];
  try {
    let image=base;
    while(image.width>1 || image.height>1) {
      image=await createImageBitmap(image,{
        resizeWidth:Math.max(1,image.width>>1), resizeHeight:Math.max(1,image.height>>1),
        resizeQuality:'high'
      });
      levels.push(image);
    }
    return levels;
  } catch(error) {
    for(const level of levels) level.close();
    throw error;
  }
}

// These particular textures can be rebuilt from the local survey and its mask on context restore.
export function releaseBitmapUpload(texture) {
  const levels=texture.mipmaps.length ? texture.mipmaps : [texture.image];
  const release=()=>{
    for(const level of levels) level.close?.();
    texture.onUpdate=null;
    texture.removeEventListener('dispose',release);
  };
  texture.onUpdate=release;
  texture.addEventListener('dispose',release);
  return texture;
}
