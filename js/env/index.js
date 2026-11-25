import { readPack } from './procedural-cache.js';
import { attribution, loadScrubCover } from './satellite.js';
import { buildGround } from './ground.js';

function clearGroup(group) {
  const resources = new Set();
  group.traverse(o => {
    if (!o.isMesh) return;
    resources.add(o.geometry);
    resources.add(o.material);
    for (const item of Object.values(o.material)) if (item?.isTexture) resources.add(item);
    if (o.isInstancedMesh) o.dispose();
  });
  group.clear();
  for (const resource of resources) resource.dispose();
}

export async function buildEnvironment(ctx) {
  const { THREE } = ctx;
  const group = new THREE.Group();
  group.name = 'Residential site environment';
  const terrain = buildGround(ctx);
  group.add(terrain.mesh);
  function layer(name) {
    const layer = new THREE.Group();
    layer.name = name;
    group.add(layer);
    return layer;
  }
  const context = layer('Road and compound furnishings');
  const vegetation = layer('Vegetation');
  const vehicles = layer('Parked vehicles and local traffic');
  let quality = ctx.quality, installed, pending, road, coverPromise, treePack, geometryPack;
  // Both caches are optional. The live procedural builders cover older WebViews.
  const cache = name => typeof DecompressionStream === 'function' ? readPack(name).catch(() => null) : null;

  async function populate() {
    coverPromise ??= loadScrubCover().catch(error => {
      console.warn('[environment] Scrub cover unavailable', error);
      return null;
    });
    if (ctx.textureQuality === 'medium') treePack ??= cache('planting-medium');
    if (quality === 'low') geometryPack ??= cache('environment-low');
    const [{buildRoad, buildCourt}, {buildTrees}, {buildVehicles}] = await Promise.all([
      import('./context.js'), import('./trees.js'), import('./vehicles.js')
    ]);
    if (!context.children.length) context.add(buildCourt(ctx));
    while (installed !== quality) {
      installed = undefined;
      const tier = quality, next = {...ctx, quality: tier};
      if (tier === 'low') geometryPack ??= cache('environment-low');
      const prototypes = tier === 'low' ? await geometryPack : null;
      const newRoad = buildRoad(next, terrain.detail, prototypes);
      // Prepare the surface maps alongside the geometry, then publish the fully textured road.
      const roadReady = terrain.mapsReady.then(() => {
        if (tier === quality) {
          if (road) {
            context.remove(road);
            road.geometry.dispose(); road.material.dispose();
          }
          context.add(newRoad); road = newRoad; ctx.invalidate();
        } else {
          newRoad.geometry.dispose(); newRoad.material.dispose();
        }
      });
      await ctx.breathe();
      const trees = new THREE.Group();
      const plantScrub = await buildTrees(next, trees, await treePack, prototypes);
      // Do not hold back the planted trees while the aerial image is decoding.
      if (tier !== quality) { clearGroup(trees); await roadReady; continue; }
      clearGroup(vegetation); vegetation.add(trees); ctx.invalidate();
      await ctx.breathe();

      const traffic = new THREE.Group();
      await buildVehicles(next, traffic, prototypes);
      if (tier !== quality) { clearGroup(traffic); await roadReady; continue; }
      clearGroup(vehicles); vehicles.add(traffic); ctx.invalidate();
      await ctx.breathe();

      await roadReady;
      const cover = await coverPromise;
      if (tier !== quality) continue;
      if (cover) { await plantScrub(cover); ctx.invalidate(); }
      installed = tier;
    }
  }
  function finish() {
    if (!pending) pending = populate().finally(() => { pending = null; });
    return pending;
  }
  return {
    group, ground: terrain.mesh, attribution, satellite: terrain.satellite, finish,
    setSatelliteVisible: terrain.setSatelliteVisible,
    setVegetationVisible(v) { vegetation.visible = !!v; ctx.invalidate(); },
    setVehiclesVisible(v) { vehicles.visible = !!v; ctx.invalidate(); },
    setContextVisible(v) { context.visible = !!v; ctx.invalidate(); },
    setQuality(q) {
      if (q === quality || !['low','medium','high'].includes(q)) return pending;
      quality = q; terrain.setQuality(q);
      if (installed !== undefined || pending) return finish();
    }
  };
}
