import { bitmapLevels, completeMips, releaseBitmapUpload } from './util.js';

export const attribution = 'Imagery © Esri, Maxar, Earthstar Geographics';
const base = new URL('../../assets/', import.meta.url);

async function readFile(name) {
  const response = await fetch(new URL(name, base));
  if (!response.ok) throw new Error(name + ' ' + response.status);
  return response;
}

let metadata;
function surveyBounds() {
  metadata ??= readFile('sat.json').then(r => r.json()).catch(error => {
    metadata = null;
    throw error;
  });
  return metadata;
}

async function decode(ctx, key) {
  const { THREE } = ctx;
  let texture;
  if (typeof createImageBitmap === 'function') {
    const blob = await (await readFile('terrain_' + key + '.jpg')).blob();
    try {
      // ImageBitmap ignores WebGL's flipY flag. Do it once, while decoding.
      const baseLevel = await createImageBitmap(blob, { imageOrientation: 'flipY' });
      texture = new THREE.Texture(baseLevel);
      texture.flipY = false;
      texture.mipmaps = await bitmapLevels(baseLevel);
      texture.generateMipmaps = false;
      releaseBitmapUpload(texture);
    } catch {
      texture = null;
    }
  }
  if (!texture) {
    texture = await new THREE.TextureLoader().loadAsync(new URL('terrain_' + key + '.jpg', base).href);
    completeMips(texture);
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(ctx.maxAnisotropy, 16);
  texture.needsUpdate = true;
  return texture;
}

export function loadImagery(ctx, apply) {
  const meta = surveyBounds();
  const loads = ['z19', 'z18'].map(async key => {
    const [texture, extents] = await Promise.all([decode(ctx, key), meta]);
    const e = extents[key];
    apply(key, texture, new ctx.THREE.Vector4(e.minX, e.minY, e.maxX - e.minX, e.maxY - e.minY));
  });
  return Promise.allSettled(loads).then(results => {
    for (const r of results) if (r.status === 'rejected') console.warn('[environment] Baked imagery unavailable', r.reason);
    return { ok: results.some(r => r.status === 'fulfilled') };
  });
}

// Read the original survey density only in finish. The original luminance samples preserve the
// scrub distribution independently of JPEG recompression and ImageBitmap orientation.
export async function loadScrubCover() {
  const [bytes, meta] = await Promise.all([
    readFile('scrub-cover.bin').then(r => r.arrayBuffer()), surveyBounds()
  ]);
  const size = 256, luminance = new Uint16Array(bytes), e = meta.z19;
  if (luminance.length !== size * size) throw new Error('Incomplete scrub cover');
  return (x, y) => {
    const u = Math.floor(size * (x - e.minX) / (e.maxX - e.minX));
    const v = Math.floor(size * (e.maxY - y) / (e.maxY - e.minY));
    if (u < 0 || u >= size || v < 0 || v >= size) return 0;
    const t = Math.min(1,Math.max(0,(luminance[v*size+u]/100 - 84)/63));
    return 1 - t*t*(3-2*t);
  };
}
