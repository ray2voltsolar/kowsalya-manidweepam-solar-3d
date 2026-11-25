import { bitmapLevels } from './util.js';
import { makeGroundMaps } from './ground-maps.js';

self.onmessage = async ({ data }) => {
  try {
    const { surface, detail } = await makeGroundMaps(data.site, data.sizes);
    const mask = await createImageBitmap(surface, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    surface.width = surface.height = 1;
    const levels = await bitmapLevels(mask);
    self.postMessage({ levels, detail }, [...levels, detail.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
