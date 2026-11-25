import { distToPolyline, rng } from './util.js';

// assumed landscape and parking layout. All setbacks are in plan metres.
export const bounds=[-87,-126,151,176]; // covers the entire compound, apron and gate throat
export const ringWidth = 6;
export const bays = { start: -63.5, width: 2.65, count: 18, back: -99.2, depth: 4.9 };
export function westVerge(site) {
  const b = site.COMPOUND.treeBelt;
  return { x0: b.x0 - 0.65, x1: b.x0 + 2.6, y0: b.y0 - 0.8, y1: b.y1 };
}
export function roadAt(site, y) {
  const line = site.ROAD.centerline;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    if (y <= ay && y >= by) return ax + (bx - ax) * (y - ay) / (by - ay);
  }
  return line[y > line[0][1] ? 0 : line.length - 1][0];
}

export async function planting(site, breathe) {
  let start=performance.now();
  const rand = rng(2083), trees = [], palms = [], shrubs = [];
  const verge = westVerge(site);
  const outlines = site.ROOF.polygons.map(p => [...p.outer, p.outer[0]]);
  const inCompound = (x,y) => site.pointInRing(x,y,site.COMPOUND.polygon);
  // Reject by bounds before visiting hundreds of traced edges for each shrub candidate.
  const barriers = [...outlines, ...site.NEIGHBOURS.map(n => [...n.polygon, n.polygon[0]])].map(ring => {
    const xs=ring.map(p=>p[0]), ys=ring.map(p=>p[1]);
    return {ring, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys)};
  });
  const southEdges = outlines.flatMap(ring => ring.slice(1).flatMap(([bx,by],i) => {
    const [ax,ay]=ring[i];
    return ay===by ? [[Math.min(ax,bx),Math.max(ax,bx),ay]] : [];
  }));
  const southByX = new Map();
  for(const edge of southEdges) {
    for(let i=Math.floor(edge[0]/8);i<=Math.floor(edge[1]/8);i++) {
      if(!southByX.has(i))southByX.set(i,[]);
      southByX.get(i).push(edge);
    }
  }
  function clear(x, y, radius) {
    if (site.pointInRing(x,y,site.COMPOUND.driveway) ||
        southByX.get(Math.floor(x/8))?.some(([lo,hi,ay])=>x>=lo && x<=hi && y<ay && y>=ay-12)) return false;
    return barriers.every(({ring,x0,x1,y0,y1}) => x<x0-radius || x>x1+radius || y<y0-radius || y>y1+radius ||
      (!site.pointInRing(x,y,ring) && distToPolyline(x,y,ring)>radius));
  }
  // assumed: staggered neem-like shade trees and occasional palms in the west planting bed.
  for (let y = verge.y0+3; y < verge.y1-3; y += 6.9+rand()*2.1) {
    const x = verge.x0+1.5+rand()*.45;
    if (!clear(x,y,1)) continue;
    if (trees.length % 4 === 2 && rand() > .4) palms.push([x,y,5.1+rand()*.8]);
    else trees.push([x,y,5.9+rand()*2.1,2.55+rand()*.7]);
  }
  // assumed: narrow planting pockets on the north and eastern boundary, clear of the access loop.
  const boundary=site.COMPOUND.polygon;
  for (let i=2; i<boundary.length-1; i++) {
    const [x0,y0]=boundary[i], [x1,y1]=boundary[i+1];
    const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy);
    for(let d=2;d<len-1;d+=2.4+rand()) {
      const x=x0+(dx*d-dy*1.1)/len, y=y0+(dy*d+dx*1.1)/len;
      if (!inCompound(x,y) || !clear(x,y,ringWidth+.5)) continue;
      if(rand()<.18) trees.push([x,y,5.2+rand()*2,1.9+rand()]);
      else shrubs.push([x,y,.55+rand()*.5,.55+rand()*.4]);
    }
  }
  // assumed: street trees on the west shoulder, leaving junctions and the entrance sightline free.
  for(let y=-171; y<127; y+=11+rand()*9) {
    const x=roadAt(site,y)-site.ROAD.width/2-3.1;
    if(clear(x,y,2) && Math.abs(y-site.COMPOUND.gate.y)>12) trees.push([x,y,5.6+rand()*2.5,2.2+rand()*1.3]);
  }
  for(let y=verge.y0+1; y<verge.y1-1; y+=1.35+rand()*.65)
    if(clear(verge.x0+.85,y,.4)) shrubs.push([verge.x0+.85,y,.58+rand()*.35,.64+rand()*.2]);
  // The open land follows the irregular east boundary. Keep the southern access track open.
  await breathe();start=performance.now();
  for(let i=0; i<245; i++) {
    if(i%24===0 && performance.now()-start>15){await breathe();start=performance.now();}
    const x=-60+rand()*205, y=-192+rand()*265;
    if(inCompound(x,y) || !clear(x,y,3) || (x<0 && y<-111 && (y>-128 || x<-51)) || x<61 && y>21) continue;
    if (distToPolyline(x,y,boundary)<4) continue;
    const h=rand();
    if(h<.095) trees.push([x,y,5.1+rand()*2,1.9+rand()*1.05]);
    else if(h<.84) shrubs.push([x,y,.6+rand()*1.35,.7+rand()*1.15]);
  }
  const tufts=[];
  // assumed: self-seeded grass beside the southern boundary and around the roots of dry scrub.
  for(let i=0;i<86;i++) {
    const x=-77+rand()*69,y=-112.45-rand()**2*6.9;
    tufts.push([x,y,.17+rand()*.33,.24+rand()*.42]);
  }
  for(const [x,y] of shrubs) {
    if(performance.now()-start>15){await breathe();start=performance.now();}
    if(inCompound(x,y))continue;
    for(let j=0;j<2;j++) {
      const a=rand()*6.28,rad=.8+rand()*1.9;
      const px=x+rad*Math.cos(a),py=y+rad*Math.sin(a);
      if(!inCompound(px,py) && clear(px,py,.7))tufts.push([px,py,.24+rand()*.53,.30+rand()*.62]);
    }
  }
  // assumed: thorn scrub colonises the stream banks in loose colonies. Actual
  // canopy density is sampled from the photograph when it is available.
  async function fieldSites(cover,quality) {
    let slice=performance.now();
    const fieldRand=rng(8120), points=[];
    const permitted=(x,y)=>!inCompound(x,y) && clear(x,y,2.1) &&
      !(y< -112 && x< -39) && !(y>23 && x<62) && !(y>99 && x<83);
    for(let i=0;i<390;i++){
      if(i%24===0 && performance.now()-slice>15){await breathe();slice=performance.now();}
      const x=-49+fieldRand()*248,y=-208+fieldRand()*394;
      const spread=3+fieldRand()*8, n=2+Math.floor(fieldRand()*7);
      for(let j=0;j<n;j++){
        const a=fieldRand()*2*Math.PI, d=spread*Math.sqrt(fieldRand());
        const px=x+Math.cos(a)*d,py=y+Math.sin(a)*d*.62;
        const h=.6+1.4*fieldRand()**1.8, rad=h*(.55+.52*fieldRand());
        const chance=fieldRand(), lod=fieldRand();
        if((cover && chance>cover(px,py)*.94) || (quality==='low' && lod>.32) ||
           (quality==='medium' && lod>.69) || !permitted(px,py))continue;
        // The bake keeps the threshold so the live survey still decides each shrub.
        points.push(cover?[px,py,h,rad]:[px,py,h,rad,chance]);
      }
    }
    return points;
  }
  return { trees, palms, shrubs, tufts, fieldSites };
}

export function vehicles(site) {
  // assumed: parked vehicles and gaps between passing southbound vehicles in
  // the eastern (far) lane. Allow for the entire vehicle, including bumpers.
  const occupied=[4,6,7,10,13,16];
  const cars=occupied.map((b,i)=>[bays.start+(b+.5)*bays.width,bays.back-bays.depth*.5,i%3===0?180:0]);
  cars.push([-32,-107.7,90]);
  for(const y of [-190,-23,29,96]) {
    const dx=roadAt(site,y+1)-roadAt(site,y-1);
    cars.push([roadAt(site,y)+2.5,y,180+Math.atan2(dx,2)*180/Math.PI]);
  }
  const bikes=[[-40.8,-100.8,167],[-39.8,-100.9,163],[-38.8,-100.8,170]]; // assumed, vacant bays
  const gate=site.COMPOUND.gate;
  const cameras=[[-92,-78,45],[-93,-128,45],[gate.x-9,gate.y-2,25]];
  const outside=(point,r)=>cameras.every(([x,y,min])=>Math.hypot(x-point[0],y-point[1])>=min+r);
  return { cars:cars.filter(p=>outside(p,2.37)), bikes:bikes.filter(p=>outside(p,1.12)) };
}
