import * as THREE from 'three';
import { V, boxAt, tubePath } from './kit.js';
import { edges, mix, rect, quad, box, pipe, edgeBar, bar } from './geometry.js';

// assumed: raised coping, mosaic-lined basin, entry steps, splash rail, timber shade and club furniture.
export function* buildPool(ctx,B,outline,z,proxy){
  const {x0,x1,y0,y1}=ctx.site.COMPOUND.pool, ring=rect(x0,y0,x1,y1),mid=(x0+x1)/2;
  const steel='#bbc1bc', timber='#a88760', depth=1.16,low=ctx.quality==='low';
  const floor=quad(ring.map(([x,y])=>[x,y,z-depth-(y1-y)*.042]),[[0,0],[1.75,0],[1.75,1.85],[0,1.85]]);
  B.add('liner',floor);
  const tone=new THREE.Color(),floorTint=floor.getAttribute('color');
  for(let i=0;i<4;i++){
    tone.set(i<2?'#569e9f':'#a6cec3');floorTint.setXYZ(i,tone.r,tone.g,tone.b);
  }
  B.add('water',quad(ring.map(p=>[...p,z-.12]),[[0,0],[2.3,0],[2.3,2.5],[0,2.5]]));
  for(const [a,b] of edges(ring)){
    edgeBar(B,'tile','#447f86',a,b,z-depth-.5,.11,depth+.5);
    edgeBar(B,'tile','#467b80',a,b,z-.24,.135,.085);
    edgeBar(B,'tile','#e6e1ce',a,b,z,.38,.09);
  }
  // A submerged return and broad entry treads catch the light beneath the water.
  for(let k=0;k<3;k++){
    box(B,'tile','#89c0bb',x0+1.82,y1-.24-.37*k,z-depth,3.32,.39,.88-.26*k);
    box(B,'tile','#b7d3c7',x0+1.82,y1-.42-.37*k,z-.28-.26*k,3.32,.055,.02);
  }
  for(const x of [x1-2.04,x1-1.48]){
    const p=[[x,y0-.48,z+.09],[x,y0-.48,z+.55],[x,y0-.25,z+.72],[x,y0+.16,z+.72],[x,y0+.32,z+.50],[x,y0+.32,z-.90]];
    B.add('metal',tubePath(p.map(pt=>V(...pt)),.032,8,.12,.09),steel);
    pipe(B,'metal',steel,[x,y0-.48,z+.085],[x,y0-.48,z+.105],.10,12);
  }
  for(let k=0;k<3;k++)pipe(B,'metal',steel,[x1-2.04,y0+.32,z-.25-.24*k],[x1-1.48,y0+.32,z-.25-.24*k],.027);
  for(const [a,b] of edges(outline)){
    yield;
    const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.6);
    for(let j=0;j<n;j++){
      const p=mix(a,b,j/n);pipe(B,'metal',steel,[...p,z+.40],[...p,z+1.12],.033);
    }
    for(const dz of [.65,.86,1.12])pipe(B,'metal',steel,[...a,z+dz],[...b,z+dz],dz>1?.036:.019);
  }
  const y=y1+4.45,x=mid+2.63,pw=5.75,pd=4.90,ph=2.65;
  box(B,'wood','#a88d6f',x,y,z+.018,pw+.24,pd+.22,.09);
  for(let i=0;i<20;i++)box(B,'wood','#7d6e59',x-pw/2+i*pw/19,y,z+.106,.023,pd+.22,.008);
  for(const sx of [-1,1])for(const sy of [-1,1]){
    box(B,'metal','#696159',x+sx*(pw/2-.17),y+sy*(pd/2-.18),z+.11,.17,.17,ph);
    box(B,'metal','#817971',x+sx*(pw/2-.17),y+sy*(pd/2-.18),z+.11,.24,.24,.14);
  }
  for(const sx of [-1,1])box(B,'wood',timber,x+sx*(pw/2-.17),y,z+ph,pd*.038,pd+.33,.22);
  for(let k=0;k<17;k++)box(B,'wood',k%3===1?'#b09269':timber,x,y-pd/2+k*pd/16,z+ph+.19,pw+.35,.14,.18);
  proxy.push(boxAt(x,y,z+ph,pw,pd,.35));
  // Glazed stair head behind the deck, with an overhang above the door.
  const sx=mid-4.65,sy=y1+5.75;
  box(B,'render','#ded4c1',sx,sy,z,3.4,3.6,2.7);
  box(B,'paving','#d7cbb9',sx,sy-.19,z+2.7,3.83,4.22,.16);
  box(B,'metal','#67716f',sx,sy-1.82,z+.06,1.57,.07,2.25);
  box(B,'glass','#849c9c',sx,sy-1.865,z+.22,1.38,.025,1.92);
  box(B,'metal',steel,sx+.48,sy-1.91,z+.92,.035,.055,.40);
  proxy.push(boxAt(sx,sy,z,3.83,4.22,2.86));
  const showerX=mid-.98,showerY=y1+3.64;
  const shower=[[showerX,showerY,z+.03],[showerX,showerY,z+2.10],[showerX,showerY-.34,z+2.10]];
  B.add('metal',tubePath(shower.map(p=>V(...p)),.028,10,.10,.10),steel);
  pipe(B,'metal',steel,[showerX,showerY-.35,z+2.03],[showerX,showerY-.35,z+2.08],.107,12,.055);
  // A wall-mounted pool ring marks the route back to the stairs.
  for(let j=0;j<8;j++){
    const arc=new THREE.TorusGeometry(.282,.065,8,8,Math.PI/4);
    arc.rotateZ(j*Math.PI/4);arc.translate(sx+1.14,1.26+z,-(sy-1.90));
    B.add('paint',arc,j%2?'#c77546':'#e4ddcc');
  }
  // Curved steel runners, sprung seat and reclining canvas backrest.
  for(const [lx,ly] of [[x-1.72,y],[x-.18,y],[x+1.42,y],[mid-2.60,y1+1.54]]){
    yield;
    const base=z+(lx<mid?.04:.11);
    for(const side of [-.31,.31]){
      const leg=[[lx+side,ly-.80,base+.39],[lx+side,ly-.70,base+.08],[lx+side,ly+.63,base+.08],[lx+side,ly+.76,base+.42]];
      B.add('metal',tubePath(leg.map(p=>V(...p)),.026,low?5:8,.06,.16),'#797b72');
    }
    box(B,'wood','#a5825d',lx,ly-.30,base+.38,.74,1.20,.10);
    box(B,'paint','#e1d7be',lx,ly-.30,base+.48,.66,1.17,.075);
    bar(B,'wood','#a5825d',[lx,ly+.28,base+.43],[lx,ly+.91,base+.96],.74,.085);
    bar(B,'paint','#e1d7be',[lx,ly+.25,base+.51],[lx,ly+.88,base+1.04],.66,.07);
  }
}
