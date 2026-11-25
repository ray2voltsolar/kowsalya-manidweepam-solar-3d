import { attribution } from './satellite.js';
import { buildGround } from './ground.js';
import { buildRoad, buildCourt } from './context.js';
import { buildTrees } from './trees.js';
import { buildVehicles } from './vehicles.js';

function clearGroup(group) {
  const resources=new Set();
  group.traverse(o=>{
    if(!o.isMesh)return;
    resources.add(o.geometry);resources.add(o.material);
    for(const item of Object.values(o.material))if(item?.isTexture)resources.add(item);
    if(o.isInstancedMesh)o.dispose();
  });
  group.clear();for(const resource of resources)resource.dispose();
}

export async function buildEnvironment(ctx) {
  const group=new ctx.THREE.Group();group.name='Residential site environment';
  function layer(name){const g=new ctx.THREE.Group();g.name=name;group.add(g);return g;}
  let landCover, plantField;
  const terrain=buildGround(ctx,cover=>{
    landCover=cover;
    plantField(cover);
  });group.add(terrain.mesh);
  const context=layer('Road and compound furnishings'), vegetation=layer('Vegetation'), vehicles=layer('Parked vehicles and local traffic');
  let road=buildRoad(ctx,terrain.detail);
  context.add(road,buildCourt(ctx));
  let quality=ctx.quality;
  plantField=buildTrees(ctx,vegetation);buildVehicles(ctx,vehicles);
  return {
    group,ground:terrain.mesh,attribution,satellite:terrain.satellite,
    setSatelliteVisible:terrain.setSatelliteVisible,
    setVegetationVisible(v){vegetation.visible=!!v;},
    setVehiclesVisible(v){vehicles.visible=!!v;},
    setContextVisible(v){context.visible=!!v;},
    setQuality(q){
      if(q===quality||!['low','medium','high'].includes(q))return;
      terrain.setQuality(q);
      clearGroup(vegetation);clearGroup(vehicles);
      const next={...ctx,quality:q};
      context.remove(road);road.geometry.dispose();road.material.dispose();
      road=buildRoad(next,terrain.detail);context.add(road);
      plantField=buildTrees(next,vegetation);
      if(landCover)plantField(landCover);
      buildVehicles(next,vehicles);
      quality=q;
    }
  };
}
