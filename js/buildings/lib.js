// Geometry is authored in the survey's east/north/up basis and batched per finish.
const plus = (a,b,s) => [a[0]+b[0]*s,a[1]+b[1]*s,a[2]+b[2]*s];
const minus = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function unit(a) {
  const k=1/(Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2])||1);
  return [a[0]*k,a[1]*k,a[2]*k];
}
export const up = [0,0,1];
export const globalFrame = {o:[0,0,0], x:[1,0,0], y:[0,1,0], z:up};
export const pt = (f,x,y,z) => [
  f.o[0]+f.x[0]*x+f.y[0]*y+f.z[0]*z,
  f.o[1]+f.x[1]*x+f.y[1]*y+f.z[1]*z,
  f.o[2]+f.x[2]*x+f.y[2]*y+f.z[2]*z,
];
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
const vertexStreams=[
  ['position',Float32Array,3],['normal',Int16Array,3],['color',Uint16Array,3],
  ['uv',Float32Array,2],['uv1',Uint16Array,2],
];
export class Batch {
  constructor(THREE) {
    this.T=THREE;this.count=0;this.capacity=0;this.indices=[];
    this.colors=new Map();this.skyAccess=1;
  }
  reserve(count){
    if(count<=this.capacity)return;
    this.capacity=Math.max(128,this.capacity*2);
    for(const [key,Type,size] of vertexStreams){
      const next=new Type(this.capacity*size);
      if(this[key])next.set(this[key]);
      this[key]=next;
    }
  }
  face(points,color,uvs,normals){
    const start=this.count;
    this.count+=points.length;
    this.reserve(this.count);
    let c=this.colors.get(color);
    if(!c){
      const linear=new this.T.Color(color);
      c=[linear.r,linear.g,linear.b].map(x=>Math.round(x*65535));
      this.colors.set(color,c);
    }
    const n=unit(cross(minus(points[1],points[0]),minus(points[points.length-1],points[0])));
    for(let i=0;i<points.length;i++){
      const [x,y,z]=points[i],N=normals?.[i]||n, v=start+i, k=3*v, t=2*v;
      this.position[k]=x;this.position[k+1]=z;this.position[k+2]=-y;
      this.normal[k]=Math.round(N[0]*32767);this.normal[k+1]=Math.round(N[2]*32767);this.normal[k+2]=Math.round(-N[1]*32767);
      this.color[k]=c[0];this.color[k+1]=c[1];this.color[k+2]=c[2];
      const access=typeof this.skyAccess==='function'?this.skyAccess(x,y,z,N):this.skyAccess;
      this.uv1[t]=Math.round(Math.max(.002,Math.min(.998,access))*65535);
      this.uv1[t+1]=32768;
      this.uv[t]=uvs?uvs[i][0]:Math.abs(n[2])>.7?x:y*n[0]-x*n[1];
      this.uv[t+1]=uvs?uvs[i][1]:Math.abs(n[2])>.7?y:z;
    }
    this.indices.push(start,start+1,start+2);
    if(points.length===4)this.indices.push(start,start+2,start+3);
  }
  geometry(){
    const T=this.T,g=new T.BufferGeometry();
    for(const [key,Type,size] of vertexStreams){
      g.setAttribute(key,new T.BufferAttribute(this[key].slice(0,this.count*size),size,Type!==Float32Array));
      this[key]=null;
    }
    g.setIndex(this.indices);
    this.indices=[];this.capacity=this.count=0;
    g.computeBoundingBox();g.computeBoundingSphere();
    return g;
  }
  mesh(name,mat,kind,cast=true) {
    const T=this.T,g=this.geometry();
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
  const slope=(r-r1)/(length||1);
  let u=x, nu=unit(plus(u,axis,slope));
  for(let i=1;i<=segments;i++) {
    const angle=i*2*Math.PI/segments, cos=Math.cos(angle), sin=Math.sin(angle);
    const v=[x[0]*cos+y[0]*sin,x[1]*cos+y[1]*sin,x[2]*cos+y[2]*sin];
    const nv=unit(plus(v,axis,slope));
    batch.face([plus(a,u,r),plus(a,v,r),plus(b,v,r1),plus(b,u,r1)],color,undefined,[nu,nv,nv,nu]);
    u=v;nu=nv;
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
// Reuse the survey's even/odd crossing test. A bay, column or pipe sample only
// needs the edges spanning its northing, including the bevels in the trace.
const footprints=new WeakMap();
function indexRing(ring){
  const rows=new Map(), xs=ring.map(p=>p[0]);
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [x,y]=ring[i],[x1,y1]=ring[j];
    if(y===y1)continue;
    const edge={x,y,x1,y1};
    for(let row=Math.floor(Math.min(y,y1));row<Math.ceil(Math.max(y,y1));row++){
      if(!rows.has(row))rows.set(row,[]);
      rows.get(row).push(edge);
    }
  }
  return {rows,minX:Math.min(...xs),maxX:Math.max(...xs)};
}
function contains(ring,x,y,row){
  if(x<ring.minX || x>=ring.maxX)return false;
  const edges=ring.rows.get(row);
  if(!edges)return false;
  let inside=false;
  for(const e of edges){
    if((e.y>y)!==(e.y1>y) && x<(e.x1-e.x)*(y-e.y)/(e.y1-e.y)+e.x)inside=!inside;
  }
  return inside;
}
export function inside(site,x,y) {
  const source=site.ROOF.polygons,row=Math.floor(y);
  let polygons=footprints.get(source);
  if(!polygons){
    polygons=source.map(p=>({outer:indexRing(p.outer),holes:p.holes.map(indexRing)}));
    footprints.set(source,polygons);
  }
  return polygons.some(p=>contains(p.outer,x,y,row)&&!p.holes.some(h=>contains(h,x,y,row)));
}
export function clearTables(site,x0,y0,x1,y1) {
  const margin=.3; // required solar maintenance clearance
  return !site.TABLES.some(t=>x1>t.x0-margin && x0<t.x1+margin && y1>t.ySouth-margin && y0<t.yNorth+margin);
}
