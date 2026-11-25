import * as THREE from 'three';

export async function buildStructures(ctx) {
  const group=new THREE.Group();
  group.name='structures';

  async function finish(){
    const [{Batch},{makeMaterials},{poolTextures},{buildNeighbours},{buildWalls},{buildPoles},{buildYard},{buildPool}]=await Promise.all([
      import('./kit.js'),import('./materials.js'),import('./textures.js'),import('./neighbours.js'),
      import('./walls.js'),import('./poles.js'),import('./yard.js'),import('./pool.js'),
    ]);
    const batch=new Batch(),meshes=new Map();
    let start=performance.now();
    async function run(steps){
      let step=steps.next();
      while(!step.done){
        if(performance.now()-start>=14){await ctx.breathe();start=performance.now();}
        step=steps.next();
      }
      return step.value;
    }
    const mats=await run(makeMaterials(ctx));
    async function show(){
      await run(batch.publish(mats,group,meshes));
      ctx.invalidate();
      await ctx.breathe();start=performance.now();
    }

    await run(buildWalls(ctx,batch));await show();
    group.userData.serviceYard=await run(buildYard(ctx,batch));await show();
    await run(mats.makeNeighbours());
    const deck=await run(buildNeighbours(ctx,batch,group));await show();
    if(deck){
      mats.setWater(await run(poolTextures(ctx.textureQuality,Math.min(ctx.maxAnisotropy,16))));
      await run(buildPool(ctx,batch,deck.outline,deck.z,deck.proxy));
      deck.register();await show();
    }
    await run(buildPoles(ctx,batch));await show();
  }
  let completion;
  return {group,finish:()=>completion??=finish(),setContextVisible(v){group.visible=Boolean(v);}};
}
