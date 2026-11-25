import {box,inside,panel,pt,ribbon,slice,tube,globalFrame,wallFrame} from './lib.js';
import {windowUV} from './textures.js';

const trim='#424847', metal='#848884', shade='#a9a69d';
const fullUV=[[0,0],[1,0],[1,1],[0,1]];
// assumed typical apartment joinery and guard dimensions in metres
const reveal=.135, railHeight=1.04, balconyDepth=1.05;
function face(batch,f,pts,col) {batch.face(pts.map(p=>pt(f,...p)),col);}
function opening(K,f,left,right,bottom,top,id,wall,rect) {
  const {walls,windows,details,low}=K;
  const [x0,x1,y0,y1]=rect;
  if(low) panel(walls,f,x0,x1,y0,y1,0,wall);
  else {
    panel(walls,f,x0,left,y0,y1,0,wall);panel(walls,f,right,x1,y0,y1,0,wall);
    panel(walls,f,left,right,y0,bottom,0,wall);panel(walls,f,left,right,top,y1,0,wall);
    face(walls,f,[[left,bottom,0],[left,bottom,-reveal],[left,top,-reveal],[left,top,0]],shade);
    face(walls,f,[[right,top,0],[right,top,-reveal],[right,bottom,-reveal],[right,bottom,0]],shade);
    face(walls,f,[[left,bottom,0],[right,bottom,0],[right,bottom,-reveal],[left,bottom,-reveal]],'#afa99c');
    face(walls,f,[[left,top,-reveal],[right,top,-reveal],[right,top,0],[left,top,0]],'#8c8a80');
  }
  const plane=low ? .009:-reveal;
  panel(windows,f,left,right,bottom,top,plane,'#f3f5f3',windowUV(id));
  if(!low) {
    const mid=(left+right)/2;
    box(details,f,mid-.018,mid+.018,bottom+.025,top-.025,plane+.004,plane+.035,trim);
    box(details,f,left+.02,right-.02,top-(top-bottom)*.225,top-(top-bottom)*.225+.028,plane+.004,plane+.024,trim);
    box(walls,f,left-.05,right+.05,bottom-.052,bottom,-.025,.095,'#c6c2b7');
  }
}
function balcony(K,f,c,w,z,variant) {
  const {walls,details,glass,low,facade}=K, a=c-w/2,b=c+w/2,d=balconyDepth;
  box(walls,f,a,b,z-.145,z+.023,.015,d+.07,facade.band);
  box(walls,f,a+.035,b-.035,z+.023,z+.058,.018,d+.035,'#beb6a6');
  const base=z+.095,top=z+railHeight;
  face(glass,f,[[a+.04,base,d],[b-.04,base,d],[b-.04,top,d],[a+.04,top,d]],facade.glass);
  for(const x of [a+.04,b-.04]) {
    face(glass,f,[[x,base,.04],[x,base,d],[x,top,d],[x,top,.04]],facade.glass);
    box(details,f,x-.018,x+.018,top,top+.043,.02,d+.023,metal);
    if(!low) box(details,f,x-.017,x+.017,z+.06,top,d-.023,d+.023,trim);
  }
  box(details,f,a+.02,b-.02,top,top+.043,d-.025,d+.027,metal);
  box(details,f,a+.02,b-.02,z+.057,base+.012,d-.03,d+.03,trim);
  if(!low) {
    box(details,f,c-.012,c+.012,base,top,d-.02,d+.02,metal);
    if(variant%4===0) {
      // assumed intermittent side privacy screen, set behind the glass return
      for(let j=0;j<5;j++) box(details,f,a+.09,a+.145,z+.06,z+2.67,.13+j*.13,.20+j*.13,'#8d8271');
    }
  }
}
function condenser(K,f,x,z) {
  // assumed compact split-system outdoor unit with bracket, fan grille and line-set
  box(K.details,f,x-.385,x+.385,z,z+.48,.08,.39,'#c6c8be');
  panel(K.fans,f,x-.38,x+.38,z+.006,z+.474,.392,'#ffffff',fullUV);
  for(const a of [x-.24,x+.24]) box(K.details,f,a-.021,a+.021,z-.045,z,.02,.405,metal);
  const a=pt(f,x+.37,z+.10,.17), b=pt(f,x+.48,z+.10,.17), c=pt(f,x+.48,z-.24,.17);
  tube(K.details,a,b,.025,'#a9a595',6);tube(K.details,b,c,.025,'#a9a595',6);
}
function apartmentEdge(K,e,seed) {
  const {f,len}=e,{site,facade,building:B}=K;
  const count=len<2.55?0:Math.max(1,Math.round(len/3.75)); // assumed bay pitch
  if(!count){panel(K.walls,f,0,len,B.stiltHeight,B.roofZ,0,facade.wall);return;}
  const w=len/count;
  for(let j=0;j<count;j++){
    const x0=j*w,x1=(j+1)*w,c=(x0+x1)/2,key=seed+3*j;
    const roomy=[x0+.12,c,x1-.12].every(s=>[.45,1.15,1.95].every(d=>{const p=pt(f,s,0,d);return !inside(site,p[0],p[1]);}));
    const isBalcony=roomy && w>2.8 && (key%7<3 || (count>7 && j%5===0));
    const accent=!isBalcony && key%6===2, plain=!isBalcony && key%13===0;
    const wall=accent?facade.accent:facade.wall;
    for(let floor=1;floor<B.floors;floor++) {
      const z=B.stiltHeight+(floor-1)*B.floorHeight, ceiling=z+B.floorHeight;
      if(plain) {panel(K.walls,f,x0,x1,z,ceiling,0,facade.wall);continue;}
      const ww=isBalcony?Math.min(w-.85,2.48):Math.min(w-.97,accent?1.32:1.79);
      const bottom=z+(isBalcony ? .11:.78),top=ceiling-.46; // assumed nominal sill and lintel
      opening(K,f,c-ww/2,c+ww/2,bottom,top,(key*11+floor*7)%16,wall,[x0,x1,z,ceiling]);
      if(isBalcony) {
        balcony(K,f,c,w-.31,z,key);
        // Selected stacks have a continuous RCC cheek and a roof over the uppermost balcony.
        if(key%3===1) {
          const a=x0+.16;
          box(K.walls,f,a,a+.15,z+.023,ceiling-.143,.018,balconyDepth+.06,facade.wall);
          if(floor===B.floors-1)box(K.walls,f,a,x1-.15,ceiling-.143,ceiling-.009,.018,balconyDepth+.07,facade.band);
        }
      }
      else {
        if(roomy && key%5!==1) box(K.walls,f,c-ww/2-.14,c+ww/2+.14,top+.055,top+.145,.002,accent ? .26:.41,facade.band);
        if(!K.low && roomy && (key+floor*3)%7===0) K.later.push(D=>condenser(D,f,c+.13,z+.20));
        if(!K.low && !accent && (key+floor)%3===0) {
          const left=c-ww/2;
          K.later.push(D=>{D.stains.skyAccess=.72;panel(D.stains,f,left-.02,left+.34,bottom-.49,bottom-.04,.004,'#ddd7c7',fullUV);});
        }
        if(accent && !K.low) {
          // Open tile joints continue across the two jambs of the feature strip.
          for(let h=.5;h<B.floorHeight;h+=.57) {
            for(const [a,b] of [[x0,c-ww/2],[c+ww/2,x1]]) panel(K.details,f,a,b,z+h,z+h+.011,.006,'#414444');
          }
        }
      }
    }
  }
}
function shaftEdge(K,e,index) {
  const {f,len}=e, B=K.building;

  if(len<2.5) return;
  // assumed pipes and frosted awning lights are concentrated in wet-service bays
  const n=Math.max(1,Math.floor(len/4.4));
  for(let i=0;i<n;i++){
    const x=(i+.5)*len/n;
    for(let fl=1;fl<B.floors;fl++){
      const h=B.stiltHeight+(fl-1)*B.floorHeight+1.56;
      box(K.details,f,x-.34,x+.34,h,h+.49,.003,.05,'#777b74');
      panel(K.details,f,x-.295,x+.295,h+.038,h+.45,.052,'#414c48');
      const awning=(index+fl+i)%3!==0;
      for(const [j,dy] of [.055,.235].entries()) {
        const opening=awning && j===1 ? .093:.008;
        face(K.details,f,[[x-.286,h+dy,.061+opening],[x+.286,h+dy,.061+opening],[x+.286,h+dy+.163,.061],[x-.286,h+dy+.163,.061]],awning?'#83938b':'#a6aaa0');
        box(K.details,f,x-.296,x+.296,h+dy-.012,h+dy+.008,.058+opening,.078+opening,'#68726d');
      }
      if(!K.low && (fl+index)%3!==1){
        const access=K.stains.skyAccess;
        K.later.push(D=>{
          D.stains.skyAccess=access;
          panel(D.stains,f,x-.42,x+.42,h-.89,h-.01,.004,'#dfd8c7',fullUV);
        });
      }
      if(!K.low)box(K.walls,f,x-.39,x+.39,h-.048,h,.014,.14,shade);
    }
  }
  if(index%3===0 || len>7){
    const access=K.details.skyAccess;
    K.later.push(D=>shaftPipes(D,e,access));
  }
}
function shaftPipes(K,e,access){
  const {f,len}=e,B=K.building;
  K.details.skyAccess=access;
  const x=Math.min(.48,len*.15);
  for(const [offset,r,col] of [[0,.063,'#a09f93'],[.23,.045,'#c4c2af']]) {
    tube(K.details,pt(f,x+offset,.12,.135),pt(f,x+offset,B.roofZ-.12,.135),r,col,8);
    for(let fl=1;fl<B.floors;fl++) {
      const h=fl*B.floorHeight-.34;
      box(K.details,f,x+offset-r*1.19,x+offset+r*1.19,h,h+.055,.025,.135+r,'#75796e');
      if(!K.low && offset===0) tube(K.details,pt(f,x+.36,h+.38,.135),pt(f,x,h+.11,.135),.042,col,7);
    }
  }
  K.details.skyAccess=.77;
}
function parking(K,p) {
  const {site,building:B}=K,F=globalFrame;
  const xs=p.outer.map(a=>a[0]),ys=p.outer.map(a=>a[1]);
  const gap=5.7; // assumed structural grid and two-car bay width
  for(let x=Math.min(...xs)+1.55;x<Math.max(...xs);x+=gap)for(let y=Math.min(...ys)+1.55;y<Math.max(...ys);y+=gap){
    const fits=(w,d)=>[-w,w].every(dx=>[-d,d].every(dy=>inside(site,x+dx,y+dy)));
    if(!inside(site,x,y)||!fits(.42,.42))continue;
    box(K.walls,F,x-.24,x+.24,y-.24,y+.24,.08,B.stiltHeight-.045,B.facade.stilt);
    box(K.walls,F,x-.25,x+.25,y-.25,y+.25,.08,.51,'#797a73');
    box(K.details,F,x-.252,x+.252,y-.252,y+.252,.52,.62,'#c7ae77');
    if(fits(.37,gap/2)) box(K.walls,F,x-.20,x+.20,y-gap/2,y+gap/2,B.stiltHeight-.34,B.stiltHeight-.03,'#96958b');
    if(!fits(gap*.49,2.4))continue;
    for(const dx of [-1.31,1.31]){
      panel(K.details,F,x+dx-.026,x+dx+.026,y-2.32,y+2.1,.095,'#cdc8b5');
      box(K.details,F,x+dx+.25,x+dx+1.02,y+1.79,y+1.97,.092,.20,'#a19b89');
    }
  }
}
function lobbies(K) {
  for(const o of K.site.OBSTACLES.filter(o=>o.type==='headroom')) {
    const x=(o.x0+o.x1)/2,y=(o.y0+o.y1)/2;
    if(!inside(K.site,x,y)) continue;
    let w=Math.min((o.x1-o.x0)/2,2.65),d=Math.min((o.y1-o.y0)/2,1.7);
    // Keep the lobby inside the traced mass even where an upper headroom bridges a shaft.
    while(w>.45 && ![-w,w].every(dx=>[-d,d].every(dy=>inside(K.site,x+dx,y+dy)))) {w*=.85;d*=.85;}
    if(w<.65)continue;
    box(K.walls,globalFrame,x-w,x+w,y-d,y+d,.08,K.building.stiltHeight-.03,'#a5a297');
    const f=wallFrame([x-w,y-d],[x+w,y-d]);
    const half=Math.min(w-.12,.85);panel(K.windows,f,w-half,w+half,.10,2.43,.014,'#dbd9c8',windowUV(0));
    box(K.walls,f,w-half-.08,w+half+.08,2.43,2.54,.01,.24,'#d4ceba');
  }
}
export function buildFacades(K,rings) {
  const surfaceAccess=K.walls.skyAccess, trimAccess=K.details.skyAccess;
  // Parking columns and cores receive progressively less skylight away from open edges.
  const exterior=rings.filter(r=>!r.hole).flatMap(r=>r.es);
  // Only edges within the original 12 m depth cap can affect a column. Index their
  // expanded bounds once and reuse the exact distance for all vertices at the same XY.
  const cells=new Map(), depths=new Map(), radius=12;
  const cellKey=(x,y)=>x+','+y;
  for(const edge of exterior){
    const {a,b}=edge;
    for(let i=Math.floor(Math.min(a[0],b[0])/radius)-1;i<=Math.floor(Math.max(a[0],b[0])/radius)+1;i++){
      for(let j=Math.floor(Math.min(a[1],b[1])/radius)-1;j<=Math.floor(Math.max(a[1],b[1])/radius)+1;j++){
        const key=cellKey(i,j);
        if(!cells.has(key))cells.set(key,[]);
        cells.get(key).push(edge);
      }
    }
  }
  const stiltAccess=(x,y,z,n)=>{
    const key=cellKey(x,y);
    let access=depths.get(key);
    if(access===undefined){
      let squared=radius*radius;
      const nearby=cells.get(cellKey(Math.floor(x/radius),Math.floor(y/radius)));
      if(nearby)for(const {a,f,len} of nearby){
        const dx=x-a[0],dy=y-a[1],t=Math.max(0,Math.min(len,dx*f.x[0]+dy*f.x[1]));
        const ex=dx-t*f.x[0],ey=dy-t*f.x[1];
        squared=Math.min(squared,ex*ex+ey*ey);
      }
      access=.14+.68*Math.exp(-Math.sqrt(squared)/2.8);
      depths.set(key,access);
    }
    return (n[2]<-.5 ? .44:.88)*access;
  };
  K.walls.skyAccess=K.details.skyAccess=stiltAccess;
  for(const p of K.site.ROOF.polygons) {
    slice(K.walls,K.THREE,p,K.building.stiltHeight-.04,'#9a9a91',true);
    slice(K.walls,K.THREE,p,.085,'#817e74'); // assumed parking floor finish
    parking(K,p);
  }
  lobbies(K);
  for(const {es,hole} of rings) {
    const shaftAccess=(x,y,z)=>.10+.60*Math.pow(z/K.building.roofZ,1.55);
    K.walls.skyAccess=hole?shaftAccess:surfaceAccess;
    K.details.skyAccess=hole?shaftAccess:trimAccess;
    K.stains.skyAccess=hole?shaftAccess:.72;
    for(const [i,e] of es.entries()) {
      if(hole){
        panel(K.walls,e.f,0,e.len,0,K.building.roofZ,0,'#b0a99b');
        shaftEdge(K,e,i);
      }
      else apartmentEdge(K,e,i+Math.round(Math.abs(e.a[0])*3));
      panel(K.mass,e.f,0,e.len,hole?0:K.building.stiltHeight,K.building.roofZ,0,'#ffffff');
    }
    if(!hole) for(let i=1;i<=K.building.floors;i++) {
      const z=i===K.building.floors?K.building.roofZ:i*K.building.floorHeight;
      ribbon(K.walls,es,.103,-.06,z-K.building.slabThickness,z+.006,K.facade.band,'#b0aea7');
    }
  }
}
