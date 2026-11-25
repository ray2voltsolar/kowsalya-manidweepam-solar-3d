import * as THREE from 'three';
import { facades, finish, poolTextures, chainMesh } from './textures.js';

export function makeMaterials(ctx) {
  const a=Math.min(ctx.maxAnisotropy||1,8), q=ctx.quality;
  const standard=(settings={},cast=true)=>({material:new THREE.MeshStandardMaterial({vertexColors:true,...settings}),cast});
  const masonry=(kind,repeat,relief)=>{
    const map=finish(q,a,kind);map.repeat.setScalar(repeat);
    return standard({map,bumpMap:map,bumpScale:relief,roughness:.91});
  };
  const water=poolTextures(q,a);
  return {
    render:masonry('render',.65,.032),stone:masonry('stone',.56,.026),
    paving:masonry('paver',.45,.016), tile:masonry('tile',1.25,.009),terrace:masonry('terrace',.078,.026),
    facade:standard({...facades(q,a),roughness:.93,bumpScale:.11}),
    metal:standard({metalness:.58,roughness:.46}),paint:standard({metalness:.16,roughness:.63}),
    glass:standard({metalness:.32,roughness:.24}),wood:masonry('timber',.76,.008),
    window:standard({metalness:.13,roughness:.15,transparent:true,opacity:.32,depthWrite:false},false),
    liner:standard({map:water.caustic,roughness:.7},false),
    water:{material:new THREE.MeshPhysicalMaterial({vertexColors:true,color:0x468e94,normalMap:water.normal,
      normalScale:new THREE.Vector2(.72,.72),roughness:.15,metalness:.05,clearcoat:1,clearcoatRoughness:.10,
      clearcoatNormalMap:water.normal,transparent:true,opacity:.48,depthWrite:false}),cast:false},
    wire:standard({map:chainMesh(a),alphaTest:.28,side:THREE.DoubleSide,roughness:.58},false),
  };
}
