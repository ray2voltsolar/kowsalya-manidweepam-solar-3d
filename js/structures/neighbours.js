import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxAt, revolve, placeAt } from './kit.js';
import { box, pipe, edgeBar, edges, mix, quad, slab, rect } from './geometry.js';
import { buildPool } from './pool.js';

// assumed throughout: façade bays, court positions, storey detailing and terrace utilities.
// Retain the traced perimeter for the balconies, plinth and roof edge.
const finishes=['#e4d5b8','#e6cdbb','#dbd8ca','#e0dacc','#c9c9c2'];
const trim='#ddd7cb',rail='#51554f';
function local(ring,u,v){return mix(mix(ring[0],ring[1],u),mix(ring[3],ring[2],u),v);}
function court(ring,u0,v0,u1,v1){return [[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>local(ring,u,v));}
function shrink(ring,dx,dy=dx){
  const w=Math.hypot(...ring[1].map((v,i)=>v-ring[0][i])), d=Math.hypot(...ring[3].map((v,i)=>v-ring[0][i]));
  return court(ring,dx/w,dy/d,1-dx/w,1-dy/d);
}
function wall(a,b,z0,z1,u0,u1,v0,v1){
  return quad([[...a,z0],[...b,z0],[...b,z1],[...a,z1]],[[u0,v0],[u1,v0],[u1,v1],[u0,v1]]);
}
function parallelPoint(a,tx,ty,s,depth){return [a[0]+tx*s+ty*depth,a[1]+ty*s-tx*depth];}

function elevations(B,site,r,z0,h,colour,id,club,commercial,low) {
  const ring=site.ringArea(r)>0?r:r.slice().reverse(), floors=Math.round((h-z0)/site.BUILDING.floorHeight);
  edges(ring).forEach(([a,b],face)=>{
    const L=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/L,ty=(b[1]-a[1])/L,rot=Math.atan2(ty,tx);
    const n=Math.max(2,Math.round(L/(club?3.7:3.5))),w=L/n;
    const at=(s,d)=>parallelPoint(a,tx,ty,s,d);
    const strip=(material,c,s,offset,width,depth,z,height)=>box(B,material,c,...at(s,offset),z,width,depth,height,rot);
    const phase=(id+face)/8;
    B.add('facade',wall(a,b,z0,h,phase,phase+n/8,0,floors/4),colour);
    for(let f=0;f<=floors;f++){
      const z=z0+f*(h-z0)/floors;
      strip('render',trim,L/2,.10,L+.15,.27,z-.17,.17);
      if(f===floors)break;
      for(let i=0;i<n;i++){
        const s=(i+.5)*w;
        if(club || commercial){
          if((i+face)%3===0) strip('stone',commercial?'#a49b8b':'#c2ab90',s-w*.47,.11,.38,.38,z, (h-z0)/floors);
          if(club && (i+face)%4===1)for(let k=-2;k<=2;k++)
            strip('wood','#997e5e',s+k*.19,.26,.08,.29,z+.19,2.6);
        }
        if((i+face+id)%4>1 || commercial || club)continue;
        // Paired recessed loggias have continuous deck edges and occasional solid privacy returns.
        strip('render',trim,s,.35,w+.03,.87,z-.14,.16);
        strip('render',colour,s,.76,w,.13,z+.02,.37);
        strip('metal',rail,s,.76,w,.048,z+.96,.047);
        if(!low)strip('metal',rail,s,.76,w,.023,z+.65,.029);
        for(let k=0;k<(low?1:4);k++)strip('metal',rail,s+w*(k/(low?1:4)-.48),.76,.033,.036,z+.39,.59);
        if((i+face+id)%4===0)strip('render',colour,s-w*.48,.36,.14,.82,z+.02,1.48);
      }
    }
    // A recessed lobby and separate columns give the stilt level a readable open depth.
    const backA=at(0,-1.9),backB=at(L,-1.9);
    B.add('glass',wall(backA,backB,.12,z0,0,1,0,1),commercial?'#424e51':'#383e38');
    if(!low && !club){
      const p=at(Math.min(L*.30,2.2),.13);
      pipe(B,'paint','#a7a396',[...p,.19],[...p,h-.2],.058);
      for(let f=1;f<=floors;f++)strip('metal','#777869',Math.min(L*.30,2.2),.13,.16,.13,z0*f-.32,.045);
    }
    for(let i=0;i<n;i++){
      strip('render',colour,(i+.5)*w,.01,.43,.49,.08,z0-.12);
      if(commercial||club) strip('metal','#767873',i*w,-1.88,.075,.11,.12,z0-.12);
    }
  });
}

function tank(B,proxy,x,y,z,r,low) {
  const h=r*1.68, profile=[[0,0],[r*.78,0],[r,.09],[r,h*.74],[r*.96,h*.88],[r*.73,h],[r*.36,h*1.03],[r*.35,h*1.10],[0,h*1.10]];
  B.add('paint',placeAt(revolve(profile,low?12:24),x,y,z),'#434542');
  for(let i=1;i<=4;i++)pipe(B,'paint','#565650',[x,y,z+i*h*.16],[x,y,z+i*h*.16+.04],r*1.015,low?12:24);
  proxy.push(boxAt(x,y,z,r*1.75,r*1.75,h));
}

function services(B,proxy,r,z,u,v,rot,low,twins){
  const [x,y]=local(r,u,v), w=5.3,d=3.8,h=2.65;
  const pos=(a,b)=>[x+a*Math.cos(rot)-b*Math.sin(rot),y+a*Math.sin(rot)+b*Math.cos(rot)];
  box(B,'render','#d6c9b2',x,y,z,w,d,h,rot);
  box(B,'paving','#c8bda8',x,y,z+h,w+.36,d+.36,.16,rot);
  proxy.push(boxAt(x,y,z,w,d,h+.16,rot));
  box(B,'paint','#757b78',...pos(-.9,-d/2-.045),z+.03,1.03,.06,2.12,rot);
  for(let k=0;k<6;k++)box(B,'metal','#6e7470',...pos(1.25,-d/2-.045),z+1.43+.09*k,.85,.09,.043,rot);
  tank(B,proxy,...pos(.85,0),z+h+.16,.91,low);
  if(twins)tank(B,proxy,...pos(-1.08,.1),z+h+.16,.78,low);
}

export function buildNeighbours(ctx,B,group) {
  const {site}=ctx, low=ctx.quality==='low';
  const proxyMaterial=new THREE.MeshBasicMaterial();
  for(const [id,building] of site.NEIGHBOURS.entries()){
    const {polygon:r,h,kind}=building,club=building.id===site.COMPOUND.pool.onRoofOf,commercial=kind==='commercial';
    const colour=finishes[id%finishes.length],proxy=[],rInner=shrink(r,club?.32:.89);
    const rot=Math.atan2(r[1][1]-r[0][1],r[1][0]-r[0][0]);
    elevations(B,site,rInner,site.BUILDING.stiltHeight,h,colour,id,club,commercial,low);
    const roofHoles=club?[]:commercial?[court(r,.26,.28,.69,.62)]:[court(r,.30,.22,.61,.40),court(r,.40,.59,.66,.76)];
    const pool=site.COMPOUND.pool;
    if(club)roofHoles.push(rect(pool.x0,pool.y0,pool.x1,pool.y1));
    B.add(club?'tile':'terrace',slab(r,roofHoles,h),club?'#ded6c3':['#e7d9c5','#d9c8b1','#ded9c9','#ddddce','#d0cabd'][id]);
    // Close the roof overhang above the set-back façades. From street level it reads as a shaded soffit.
    const soffit=slab(r,[rInner],h-.19);
    for(let j=0;j<soffit.index.count;j+=3){
      const indices=soffit.index.array;[indices[j],indices[j+1]]=[indices[j+1],indices[j]];
    }
    soffit.computeVertexNormals();B.add('render',soffit,'#c8c2b5');
    B.add('render',slab(r,[],.10),'#afaa9e');
    for(const [a,b] of edges(r)){
      edgeBar(B,'render',trim,a,b,h-.2,.21,.25);
      edgeBar(B,'render',colour,a,b,h,.19,club?.35:.76);
      edgeBar(B,'paving','#eee8d9',a,b,h+(club?.35:.76),.26,.075);
    }
    if(club)buildPool(ctx,B,r,h,proxy);
    else {
      for(const hole of roofHoles){
        const inner=site.ringArea(hole)<0?hole:hole.slice().reverse();
        for(const [a,b] of edges(inner)){
          const bays=Math.max(2,Math.round(Math.hypot(b[0]-a[0],b[1]-a[1])/3.3));
          B.add('facade',wall(a,b,.1,h,0,bays/8,0,h/12),'#a8a394');
          edgeBar(B,'render','#d1c7b4',a,b,h,.20,.70);
        }
      }
      services(B,proxy,r,h,.73,.20,rot,low,id%2===0);
      services(B,proxy,r,h,.23,.77,rot,low,id%2===1);
      // assumed low service plinths, ventilation cowls and water lines along the roof's accessible side.
      for(let j=0;j<3;j++){
        const [vx,vy]=local(r,.14,.18+j*.24);
        box(B,'render','#b9b2a0',vx,vy,h,1.22,1.0,.30,rot);
        box(B,'paint','#878a80',vx,vy,h+.30,.86,.62,.29,rot);
        box(B,'paving','#ccc2ac',vx,vy,h+.59,1.27,1.03,.11,rot);
      }
      const from=local(r,.76,.22),bend=local(r,.84,.22),to=local(r,.84,.77);
      for(const [a,b] of [[from,bend],[bend,to]])edgeBar(B,'paint','#a2a79b',a,b,h+.1,.105,.11);
      for(const [a,b] of edges(shrink(r,2.2)))edgeBar(B,'paving','#b5aa97',a,b,h+.005,.16,.045);
    }
    // Analysis only sees a watertight perimeter silhouette and terrace obstructions.
    const outer=site.ringArea(r)>0?r:r.slice().reverse();
    for(const [a,b] of edges(outer))proxy.push(wall(a,b,0,h+(club?.43:.84),0,1,0,1));
    proxy.push(slab(outer,[],h));
    const g=mergeGeometries(proxy,false),m=new THREE.Mesh(g,proxyMaterial);
    proxy.forEach(part=>part.dispose());
    m.name='structures:neighbour:'+building.id;m.visible=false;
    Object.assign(m.userData,{kind,siteId:building.id,occluderCategory:'neighbours',occluderCount:1});
    group.add(m);ctx.registerOccluder(m);
  }
}
