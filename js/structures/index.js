import * as THREE from 'three';
import { Batch } from './kit.js';
import { makeMaterials } from './materials.js';
import { buildNeighbours } from './neighbours.js';
import { buildWalls } from './walls.js';
import { buildPoles } from './poles.js';
import { buildYard } from './yard.js';

export async function buildStructures(ctx) {
  const group=new THREE.Group();group.name='structures';
  const b=new Batch(), mats=makeMaterials(ctx);
  buildNeighbours(ctx,b,group);
  buildWalls(ctx,b);
  buildPoles(ctx,b);
  group.userData.serviceYard=buildYard(ctx,b);
  b.build(mats,group);
  return {group,setContextVisible(v){group.visible=Boolean(v);}};
}
