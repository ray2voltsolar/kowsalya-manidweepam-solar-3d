import * as THREE from 'three';
import { V, boxAt, boxUV, beam, cylBetween } from './kit.js';

export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const edges = ring => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
export function quad(points, uvs = [[0,0],[1,0],[1,1],[0,1]]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(p => V(...p).toArray()), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  g.setIndex([0,1,2,0,2,3]); g.computeVertexNormals();
  return g;
}
export function slab(ring, holes, z, scale = 1) {
  const all = [ring, ...holes];
  const vectors=points=>points.map(p=>new THREE.Vector2(...p));
  const faces=THREE.ShapeUtils.triangulateShape(vectors(ring), holes.map(vectors));
  const pts = all.flat(), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(([x,y]) => [x,z,-y]),3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pts.flatMap(([x,y])=>[x*scale,y*scale]),2));
  g.setIndex(faces.flat()); g.computeVertexNormals();
  return g;
}
export function box(B,key,tint,x,y,z,w,d,h,rot=0) {
  return B.add(key,boxUV(boxAt(x,y,z,w,d,h,rot),1),tint);
}
export function bar(B,key,tint,a,b,width,height) {
  return B.add(key,boxUV(beam(V(...a),V(...b),width,height),1),tint);
}
export function pipe(B,key,tint,a,b,radius,sides=8,endRadius=radius) {
  return B.add(key,cylBetween(V(...a),V(...b),radius,sides,endRadius),tint);
}
export function edgeBar(B,key,tint,a,b,z,width,height) {
  return bar(B,key,tint,[...a,z+height/2],[...b,z+height/2],width,height);
}
export function rect(x0,y0,x1,y1) {return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];}
