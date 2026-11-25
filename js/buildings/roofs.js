import {box,clearTables,edges,globalFrame,inside,pt,ribbon,slice,tube} from './lib.js';

export function roofRings(site) {
  return site.ROOF.polygons.flatMap(p=>[p.outer,...p.holes].map((r,i)=>({es:edges(r),hole:i>0})));
}
export function rainOutlets(site,rings) {
  const out=[];
  for(const {es} of rings) for(const e of es) {
    if(e.len<5.8 || out.some(d=>Math.hypot(e.a[0]-d.x,e.a[1]-d.y)<10))continue;
    const [x,y]=pt(e.f,.55,0,-.36); // assumed drain behind parapet at the return
    if(inside(site,x,y) && clearTables(site,x-.17,y-.17,x+.17,y+.17))out.push({x,y});
  }
  return out;
}
function* installServices(K,rings) {
  const z=K.building.roofZ, fixtures=K.site.OBSTACLES;
  const roomEnds=[];
  const free=(x,y,source)=>{
    const r=.16; // assumed maximum support half-width
    return clearTables(K.site,x-r,y-r,x+r,y+r)
      && [-r,r].every(dx=>[-r,r].every(dy=>inside(K.site,x+dx,y+dy)))
      && !fixtures.some(o=>o!==source && x+r>o.x0&&x-r<o.x1&&y+r>o.y0&&y-r<o.y1);
  };
  const segmentFree=(a,b,source)=>{
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(length/.12));
    if(!clearTables(K.site,Math.min(a[0],b[0])-.16,Math.min(a[1],b[1])-.16,Math.max(a[0],b[0])+.16,Math.max(a[1],b[1])+.16))return false;
    for(let i=0;i<=n;i++) if(!free(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,source))return false;
    return true;
  };
  for(const {es,hole} of rings) if(hole) for(const e of es) {
    if(e.len<1.2)continue;
    for(let t=.55;t<e.len-.3;t+=1.1)roomEnds.push(pt(e.f,t,z+.22,-.29));
  }
  const lay=(a,b)=>{
    const l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<.02)return;
    tube(K.services,a,b,.057,'#9b9e94',10);
    const n=Math.max(1,Math.ceil(l/1.9));
    for(let i=0;i<n;i++) {
      const t=(i+.5)/n,x=a[0]+t*(b[0]-a[0]),y=a[1]+t*(b[1]-a[1]);
      box(K.services,globalFrame,x-.13,x+.13,y-.13,y+.13,z,z+.165,'#a9a494');
      const alongX=Math.abs(a[0]-b[0])>.1,dx=alongX ? .026:0,dy=alongX?0:.026;
      tube(K.services,[x-dx,y-dy,z+.22],[x+dx,y+dy,z+.22],.065,'#787e76',10);
    }
  };
  for(const o of fixtures.filter(o=>o.tank||o.type==='tank')) {
    const x=(o.x0+o.x1)/2,y=(o.y0+o.y1)/2;
    const starts=K.ports.get(o.id) || [[o.x0-.19,y],[o.x1+.19,y],[x,o.y0-.19],[x,o.y1+.19]].map(p=>({point:[...p,z+.22]}));
    const candidates=[];
    for(const port of starts){
      const a=port.point;
      for(const b of roomEnds){
        const l=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
        if(l>.85 && l<16)candidates.push({a,b,port,l});
      }
    }
    candidates.sort((a,b)=>a.l-b.l);
    let done=false;
    for(const {a,b,port} of candidates) {
      yield;
      for(const mid of [[a[0],b[1],a[2]],[b[0],a[1],a[2]]]) {
        if(!segmentFree(a,mid,o)||!segmentFree(mid,b,o))continue;
        const hi=o.type==='tank'?o.z0+.48:o.zTop+.12;
        tube(K.services,[a[0],a[1],hi],a,.057,'#a0a197',10);
        const face=port.wall || [Math.max(o.x0,Math.min(o.x1,a[0])),Math.max(o.y0,Math.min(o.y1,a[1])),hi];
        tube(K.services,face,[a[0],a[1],hi],.057,'#a0a197',10);
        const feed=K.manifolds.get(o.id);
        if(feed) {
          const elbow=[feed[0],face[1],hi];
          for(const [u,v] of [[feed,elbow],[elbow,face]]) if(Math.hypot(u[0]-v[0],u[1]-v[1])>.01)tube(K.services,u,v,.048,'#94988e',10);
        }
        lay(a,mid);lay(mid,b);
        tube(K.services,b,[b[0],b[1],z+.035],.057,'#a0a197',10);
        done=true;break;
      }
      if(done)break;
    }
  }
  // Short parallel distribution runs follow long, unobstructed parapet stretches.
  let count=0;
  for(const {es} of rings) for(const e of es) {
    if(count>=6)return;
    if(e.len<8)continue;
    yield;
    const a=pt(e.f,.65,z+.22,-.36), b=pt(e.f,Math.min(e.len-.65,8.4),z+.22,-.36);
    if(!segmentFree(a,b))continue;
    lay(a,b);
    for(const p of [a,b])tube(K.services,p,[p[0],p[1],z+.014],.057,'#999c93',10);
    count++;
  }
}
export function buildTerraces(K,rings) {
  const z=K.building.roofZ, {height,thickness}=K.building.parapet;
  for(const p of K.site.ROOF.polygons)slice(K.roof,K.THREE,p,z,'#ffffff');
  for(const {es} of rings) {
    // The outer face follows the survey. The cap is inset by its own depth from the nominal top.
    ribbon(K.parapets,es,0,-thickness,z,z+height-.073,'#cbc6ba');
    ribbon(K.parapets,es,.033,-thickness-.033,z+height-.073,z+height,'#e2ded1');
    ribbon(K.parapets,es,-thickness,-thickness-.044,z+.009,z+.145,'#aaa393');
  }
}
export function* buildServices(K,rings,drains) {
  const z=K.building.roofZ;
  for(const {x,y} of drains) {
    box(K.services,globalFrame,x-.127,x+.127,y-.127,y+.127,z+.001,z+.009,'#66675e');
    if(!K.low)for(let j=-3;j<=3;j++)box(K.services,globalFrame,x+j*.029-.005,x+j*.029+.005,y-.115,y+.115,z+.009,z+.015,'#98998b');
  }
  if(!K.low)yield* installServices(K,rings);
}
