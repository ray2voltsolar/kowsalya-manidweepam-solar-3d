import {Batch} from './lib.js';
import {materials} from './materials.js';
import {buildFacades} from './walls.js';
import {buildTerraces,buildServices,rainOutlets,roofRings} from './roofs.js';
import {roofFurniture} from './special.js';

export async function buildBuildings(ctx) {
  const {site,THREE}=ctx, building=site.BUILDING,group=new THREE.Group(),furniture=new THREE.Group();
  group.name=building.name+' · RCC apartment complex';furniture.name='Terrace equipment and services';
  const rings=roofRings(site),drains=rainOutlets(site,rings);
  const mats=materials(ctx,drains);
  const K={site,THREE,building,facade:building.facade,low:ctx.quality==='low',mats,furniture,later:[],ports:new Map(),manifolds:new Map()};
  for(const key of ['stains','walls','windows','details','glass','fans','roof','parapets','mass','furnitureProxy','services'])K[key]=new Batch(THREE);
  K.walls.skyAccess=(x,y,z,n)=>n[2]<-.6 ? .32:.74;
  K.windows.skyAccess=.66; K.details.skyAccess=.77; K.glass.skyAccess=.91; K.roof.skyAccess=.77;
  K.parapets.skyAccess=(x,y,z,n)=>n[2]>.7 ? .91:.74;
  buildFacades(K,rings);
  roofFurniture(K);
  buildTerraces(K,rings);
  const add=(parent,batch,name,mat,kind,cast=true)=>{
    if(!batch.count)return null;
    const mesh=batch.mesh(name,mat,kind,cast);parent.add(mesh);return mesh;
  };
  add(group,K.walls,'Rendered masonry, parking stilt and RCC slab edges',mats.stucco,'building');
  add(group,K.windows,'Sliding aluminium windows and balcony doors',mats.windows,'building');
  const details=add(group,K.details,'Joinery, rails and service fittings',mats.fittings,'building',false);
  add(group,K.glass,'Laminated balcony glass',mats.balustrade,'building',false);
  const roofMesh=add(group,K.roof,'Waterproofed terrace screed',mats.terrace,'terrace');
  const parapets=add(group,K.parapets,'Mitred parapets and precast coping',mats.stucco,'parapet');
  group.add(furniture);
  // Detached proxies live in survey coordinates, the same world basis as the shading registry.
  // This also keeps them out of the camera's depth buffer and the ordinary picking pass.
  const mass=K.mass.mesh('RCC shell · shading proxy',mats.proxy,'building',false);
  const equipment=K.furnitureProxy.mesh('Equipment envelopes · shading proxy',mats.proxy,'roof-furniture',false);
  const occluders=[roofMesh,parapets,mass,equipment];
  for(const mesh of occluders){mesh.updateMatrixWorld(true);ctx.registerOccluder(mesh);}
  const stats={};
  function count(){
    stats.triangles=stats.drawCalls=0;
    group.traverse(o=>{if(o.isMesh){stats.triangles+=o.geometry.index.count/3;stats.drawCalls++;}});
  }
  count();

  // Keep the original single draw per material once the smaller fittings arrive.
  function append(mesh,batch){
    if(!batch.count)return;
    const old=mesh.geometry,extra=batch.geometry();
    const merged=new THREE.BufferGeometry();
    for(const [key,a] of Object.entries(old.attributes)){
      const b=extra.attributes[key],data=new a.array.constructor(a.array.length+b.array.length);
      data.set(a.array);data.set(b.array,a.array.length);
      merged.setAttribute(key,new THREE.BufferAttribute(data,a.itemSize,a.normalized));
    }
    const base=old.attributes.position.count;
    const Index=base+extra.attributes.position.count>=65535?Uint32Array:Uint16Array;
    const indices=new Index(old.index.count+extra.index.count);
    indices.set(old.index.array);
    for(let i=0;i<extra.index.count;i++)indices[old.index.count+i]=base+extra.index.array[i];
    merged.setIndex(new THREE.BufferAttribute(indices,1));
    merged.boundingSphere=old.boundingSphere.clone().union(extra.boundingSphere);
    merged.boundingBox=old.boundingBox.clone().union(extra.boundingBox);
    mesh.geometry=merged;
    old.dispose();extra.dispose();
  }
  async function finishDetails(){
    let start=performance.now();
    const D={...K,details:new Batch(THREE)};
    D.details.skyAccess=.77;
    for(const job of K.later){
      job(D);
      if(performance.now()-start>16){await ctx.breathe();start=performance.now();}
    }
    K.later.length=0;
    await ctx.breathe();
    // Fan faces and condenser bodies become visible together, even if texture
    // creation or packing needs to cross a frame boundary.
    const fans=D.fans.count?D.fans.mesh('Condenser fan grilles',mats.makeFans(),'building',false):null;
    const stains=D.stains.count?D.stains.mesh('Mineral trails beneath sills and outlets',mats.makeStains(),'building',false):null;
    await ctx.breathe();
    append(details,D.details);
    if(fans)group.add(fans);
    if(stains)group.add(stains);
    count();ctx.invalidate();
    await ctx.breathe();
    start=performance.now();
    for(const _ of buildServices(D,rings,drains)){
      if(performance.now()-start>16){await ctx.breathe();start=performance.now();}
    }
    add(furniture,D.services,'Terrace plumbing, saddles and rainwater gratings',mats.equipment,'roof-furniture');
    count();ctx.invalidate();
  }
  let completion;
  return {group,roofMesh,occluders,stats,finish:()=>completion??=finishDetails(),
    setFurnitureVisible(visible){furniture.visible=Boolean(visible);}};
}
