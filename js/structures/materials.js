import * as THREE from 'three';
import { facades, finish, chainMesh } from './textures.js';

export function* makeMaterials(ctx) {
  const a=Math.min(ctx.maxAnisotropy,16), q=ctx.textureQuality;
  const standard=(settings={},cast=true)=>({material:new THREE.MeshStandardMaterial({vertexColors:true,...settings}),cast});
  const masonry=(kind,repeat,relief)=>{
    const map=finish(q,a,kind);map.repeat.setScalar(repeat);
    return standard({map,bumpMap:map,bumpScale:relief,roughness:.91});
  };
  const mats={
    metal:standard({metalness:.58,roughness:.46}),paint:standard({metalness:.16,roughness:.63}),
    glass:standard({metalness:.32,roughness:.24}),
    window:standard({metalness:.13,roughness:.15,transparent:true,opacity:.32,depthWrite:false},false),
  };
  for(const [key,kind,repeat,relief] of [
    ['render','render',.65,.032],['stone','stone',.56,.026],['paving','paver',.45,.016],
    ['wood','timber',.76,.008],
  ]){
    mats[key]=masonry(kind,repeat,relief);
    yield;
  }
  // The atlas, terrace finishes and pool maps are only needed by later stages.
  mats.makeNeighbours=function* (){
    mats.facade=standard({...facades(q,a),roughness:.93,bumpScale:.11});yield;
    mats.terrace=masonry('terrace',.078,.026);yield;
    mats.tile=masonry('tile',1.25,.009);
  };
  mats.wire=standard({map:chainMesh(q,a),alphaTest:.28,side:THREE.DoubleSide,roughness:.58},false);
  mats.setWater=water=>{
    mats.liner=standard({map:water.caustic,roughness:.7},false);
    mats.water={material:new THREE.MeshPhysicalMaterial({vertexColors:true,color:0x468e94,normalMap:water.normal,
      normalScale:new THREE.Vector2(.72,.72),roughness:.15,metalness:.05,clearcoat:1,clearcoatRoughness:.10,
      clearcoatNormalMap:water.normal,transparent:true,opacity:.48,depthWrite:false}),cast:false};
  };
  return mats;
}
