// Geometry is authored in the survey's east/north/up basis and batched per finish.
const plus = (a, b, s) => a.map((v, i) => v + b[i] * s);
const minus = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => a.map(v => v / (Math.hypot(...a) || 1));
export const up = [0,0,1];
export const globalFrame = {o:[0,0,0], x:[1,0,0], y:[0,1,0], z:up};
export const pt = (f,x,y,z) => plus(plus(plus(f.o,f.x,x),f.y,y),f.z,z);
export function wallFrame(a,b) {
  const x = unit([b[0]-a[0], b[1]-a[1], 0]);
  return {o:[a[0],a[1],0], x, y:up, z:cross(x,up)};
}
export function edges(ring) {
  return ring.map((a,i) => {
    const b = ring[(i+1)%ring.length], f = wallFrame(a,b);
    return {a,b,f,len:Math.hypot(b[0]-a[0], b[1]-a[1])};
  });
}
export function offsetRing(es, d) {
  const points = es.map((e,i) => {
    const a = es[(i+es.length-1)%es.length].f.z, b = e.f.z;
    const k = d / Math.max(.001, 1+a[0]*b[0]+a[1]*b[1]);
    return [e.a[0]+k*(a[0]+b[0]), e.a[1]+k*(a[1]+b[1])];
  });
  // The trace has short bevels. Collapse a reversed bevel to its neighbours' intersection.
  for (let i=0;i<es.length;i++) {
    const j=(i+1)%es.length, a=points[i], b=points[j], t=es[i].f.x;
    if ((b[0]-a[0])*t[0]+(b[1]-a[1])*t[1]>=0) continue;
    const last=es[(i+es.length-1)%es.length].f.x, next=es[j].f.x;
    const det=last[0]*next[1]-last[1]*next[0];
    if (Math.abs(det)<1e-8) continue;
    const k=((b[0]-a[0])*next[1]-(b[1]-a[1])*next[0])/det;
    points[i]=points[j]=[a[0]+last[0]*k,a[1]+last[1]*k];
  }
  return points;
}
export function rng(seed) {
  let s = seed >>> 0;
  return () => {s=(Math.imul(1664525,s)+1013904223)>>>0; return s/4294967296;};
}
export class Batch {
  constructor(THREE) {
    this.T=THREE; this.pos=[]; this.norm=[]; this.uv=[]; this.rgb=[]; this.indices=[];
    this.colors=new Map(); this.ambient=[]; this.skyAccess=1;
  }
  face(points, color, uvs, normals) {
    const start=this.pos.length/3;
    let c=this.colors.get(color);
    if (!c) {c=new this.T.Color(color); this.colors.set(color,c);}
    const n=unit(cross(minus(points[1],points[0]),minus(points[points.length-1],points[0])));
    // Metric UVs for horizontal and vertical finishes.
    points.forEach(([x,y,z],i)=>{
      const N=normals?.[i] || n;
      this.pos.push(x,z,-y); this.norm.push(N[0],N[2],-N[1]); this.rgb.push(c.r,c.g,c.b);
      const access=typeof this.skyAccess==='function'?this.skyAccess(x,y,z,N):this.skyAccess;
      this.ambient.push(Math.max(.002,Math.min(.998,access)),.5);
      this.uv.push(...(uvs?.[i] || (Math.abs(n[2])>.7 ? [x,y] : [x*(-n[1])+y*n[0],z])));
    });
    this.indices.push(start,start+1,start+2);
    if(points.length===4) this.indices.push(start,start+2,start+3);
  }
  mesh(name,mat,kind,cast=true) {
    const T=this.T, g=new T.BufferGeometry();
    for(const [key,data,size] of [['position',this.pos,3],['normal',this.norm,3],['uv',this.uv,2],['color',this.rgb,3],['uv1',this.ambient,2]]) {
      g.setAttribute(key,new T.Float32BufferAttribute(data,size));
    }
    g.setIndex(this.indices); g.computeBoundingBox(); g.computeBoundingSphere();
    const m=new T.Mesh(g,mat); m.name=name; m.userData.kind=kind; m.castShadow=cast; m.receiveShadow=true;
    return m;
  }
}
export function panel(batch,f,x0,x1,y0,y1,z,color,uv) {
  batch.face([[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]].map(p=>pt(f,...p)),color,uv);
}
export function box(batch,f,x0,x1,y0,y1,z0,z1,color) {
  const p=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]].map(v=>pt(f,...v));
  for(const face of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]) batch.face(face.map(i=>p[i]),color);
}
export function tube(batch,a,b,r,color,segments=8,r1=r) {
  const axis=unit(minus(b,a)), x=unit(cross(axis,Math.abs(axis[2])>.9?[0,1,0]:up)), y=cross(axis,x);
  const length=Math.hypot(...minus(b,a));
  for(let i=0;i<segments;i++) {
    const radii=[i,i+1].map(k=>plus(plus([0,0,0],x,Math.cos(k*2*Math.PI/segments)),y,Math.sin(k*2*Math.PI/segments)));
    const [u,v]=radii;
    const nu=unit(plus(u,axis,(r-r1)/length)), nv=unit(plus(v,axis,(r-r1)/length));
    batch.face([plus(a,u,r),plus(a,v,r),plus(b,v,r1),plus(b,u,r1)],color,undefined,[nu,nv,nv,nu]);
  }
}
export function slice(batch,THREE,polygon,z,color,underside=false) {
  const rings=[polygon.outer,...polygon.holes], points=rings.flat();
  const vectors=rings.map(r=>r.map(p=>new THREE.Vector2(...p)));
  for(const idx of THREE.ShapeUtils.triangulateShape(vectors[0],vectors.slice(1))) {
    const p=idx.map(i=>[...points[i],z]); if(underside) p.reverse();
    batch.face(p,color);
  }
}
// A watertight, mitred ribbon. Keep whole-ring offsets so faces meet at every return.
export function ribbon(batch,es,front,back,z0,z1,color,baseColor=color) {
  const a=offsetRing(es,front), b=offsetRing(es,back);
  for(let i=0;i<a.length;i++) {
    const j=(i+1)%a.length, p=a[i], q=a[j], r=b[j], s=b[i];
    batch.face([[...p,z0],[...q,z0],[...q,z1],[...p,z1]],color);
    batch.face([[...r,z0],[...s,z0],[...s,z1],[...r,z1]],color);
    batch.face([[...p,z1],[...q,z1],[...r,z1],[...s,z1]],color);
    batch.face([[...s,z0],[...r,z0],[...q,z0],[...p,z0]],baseColor);
  }
}
export function inside(site,x,y) {
  return site.ROOF.polygons.some(p=>site.pointInRing(x,y,p.outer)&&!p.holes.some(h=>site.pointInRing(x,y,h)));
}
export function clearTables(site,x0,y0,x1,y1) {
  const margin=.3; // required solar maintenance clearance
  return !site.TABLES.some(t=>x1>t.x0-margin && x0<t.x1+margin && y1>t.ySouth-margin && y0<t.yNorth+margin);
}
