import {Batch} from './lib.js';
import {materials} from './materials.js';
import {buildFacades} from './walls.js';
import {buildTerraces,rainOutlets,roofRings} from './roofs.js';
import {roofFurniture} from './special.js';

export async function buildBuildings(ctx) {
  const {site,THREE}=ctx, building=site.BUILDING,group=new THREE.Group(),furniture=new THREE.Group();
  group.name=building.name+' · RCC apartment complex';furniture.name='Terrace equipment and services';
  const rings=roofRings(site),drains=rainOutlets(site,rings);
  const mats=materials(ctx,drains);
  const K={site,THREE,building,facade:building.facade,low:ctx.quality==='low',mats,furniture,ports:new Map(),manifolds:new Map()};
  for(const key of ['stains','walls','windows','details','glass','fans','roof','parapets','mass','furnitureProxy','services'])K[key]=new Batch(THREE);
  K.walls.skyAccess=(x,y,z,n)=>n[2]<-.6 ? .32:.74;
  K.windows.skyAccess=.66; K.details.skyAccess=.77; K.glass.skyAccess=.91; K.roof.skyAccess=.77;
  K.parapets.skyAccess=(x,y,z,n)=>n[2]>.7 ? .91:.74;
  buildFacades(K,rings);roofFurniture(K);buildTerraces(K,rings,drains);
  const add=(parent,batch,name,mat,kind,cast=true)=>{
    if(!batch.indices.length)return null;
    const mesh=batch.mesh(name,mat,kind,cast);parent.add(mesh);return mesh;
  };
  add(group,K.walls,'Rendered masonry, parking stilt and RCC slab edges',mats.stucco,'building');
  add(group,K.windows,'Sliding aluminium windows and balcony doors',mats.windows,'building');
  add(group,K.details,'Joinery, rails and service fittings',mats.fittings,'building',false);
  add(group,K.glass,'Laminated balcony glass',mats.balustrade,'building',false);
  add(group,K.stains,'Mineral trails beneath sills and outlets',mats.stains,'building',false);
  add(group,K.fans,'Condenser fan grilles',mats.fans,'building',false);
  const roofMesh=add(group,K.roof,'Waterproofed terrace screed',mats.terrace,'terrace');
  const parapets=add(group,K.parapets,'Mitred parapets and precast coping',mats.stucco,'parapet');
  add(furniture,K.services,'Terrace plumbing, saddles and rainwater gratings',mats.equipment,'roof-furniture');
  group.add(furniture);
  // Detached proxies live in survey coordinates, the same world basis as the shading registry.
  // This also keeps them out of the camera's depth buffer and the ordinary picking pass.
  const mass=K.mass.mesh('RCC shell · shading proxy',mats.proxy,'building',false);
  const equipment=K.furnitureProxy.mesh('Equipment envelopes · shading proxy',mats.proxy,'roof-furniture',false);
  const occluders=[roofMesh,parapets,mass,equipment];
  for(const mesh of occluders){mesh.updateMatrixWorld(true);ctx.registerOccluder(mesh);}
  const stats={triangles:0,drawCalls:0};
  group.traverse(o=>{if(o.isMesh){stats.triangles+=o.geometry.index.count/3;stats.drawCalls++;}});
  return {group,roofMesh,occluders,stats,setFurnitureVisible(visible){furniture.visible=Boolean(visible);}};
}
