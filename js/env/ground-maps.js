import { makeCanvas, rng, valueNoise } from './util.js';
import { bounds, ringWidth, westVerge } from './layout.js';

function surfaceMask(site, side) {
  const c=makeCanvas(side,side), g=c.getContext('2d');
  const [x,y,w,h]=bounds;
  g.setTransform(side/w,0,0,-side/h,-x*side/w,(y+h)*side/h);
  const trace=ring=>{g.beginPath();ring.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();};
  const fill=(ring,col)=>{trace(ring);g.fillStyle=col;g.fill();};
  const rect=(x0,y0,x1,y1,color)=>{g.fillStyle=color;g.fillRect(x0,y0,x1-x0,y1-y0);};
  const property=site.COMPOUND.polygon;
  const apron=property.map(([px,py])=>[px,py-9]);
  // The southern projection also covers the stepped eastern boundary where the roof image leans out.
  g.lineJoin='round'; g.lineCap='round';
  for(const ring of [apron,property]) {
    trace(ring);
    for(let i=12;i>0;i--){g.lineWidth=i*.46;g.strokeStyle='rgba(0,0,0,.19)';g.stroke();}
    g.fillStyle='#000';g.fill();
  }
  g.save();trace(property);g.clip();
  fill(property,'#00ff00');
  for(const p of site.ROOF.polygons) {
    trace(p.outer);g.strokeStyle='#ff0000';g.lineWidth=ringWidth*2;g.stroke();g.fillStyle='#ff0000';g.fill();
  }
  const v=westVerge(site);
  rect(v.x0,v.y0,v.x1,v.y1,'#00ff00');
  fill(site.COMPOUND.driveway,'#ff0000');
  const gate=site.COMPOUND.gate;
  rect(gate.x,-112,gate.x+12,-98.25,'#ff0000'); // assumed entrance court
  for(const p of site.ROOF.polygons) {
    fill(p.outer,'#0000ff');
    p.holes.forEach(hole=>fill(hole,'#0000ff'));
  }
  // A darker paver course runs along the parking edge and the boundary return.
  rect(-79.8,-111.45,-6.35,-111.03,'#ac0000'); // assumed
  rect(-74,-104.45,-9,-104.16,'#bd0000'); // assumed
  g.restore();
  rect(gate.x-4,gate.y-gate.width/2,gate.x+.2,gate.y+gate.width/2,'#ff0000');
  // The metre-scale land-use mask needs edge coverage only. Grain uses a separate mipmapped tile.
  return c;
}

// Packed repeating detail: R fired/concrete interlock, G mineral aggregate, B turf, A weathering.
// Both the material grain and the bevel survive downsampling through the normal mip chain.
// The lattice repeats. Precompute the seeded corner values once per tile.
function noiseGrid(period, seed) {
  const stride=period+1, table=new Float64Array(stride*stride);
  for(let y=0;y<=period;y++) for(let x=0;x<=period;x++) table[y*stride+x]=valueNoise(x,y,seed,period);
  return (x,y)=>{
    const i=Math.floor(x),j=Math.floor(y), k=j*stride+i,fx=x-i,fy=y-j;
    const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
    const a=table[k],b=table[k+1],c=table[k+stride],d=table[k+stride+1];
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
  };
}

async function detailPixels(n, breathe) {
  const rand=rng(49);
  const data=new Uint8Array(n*n*4), units=16;
  const block=noiseGrid(16,539),weather=noiseGrid(8,203),grass=noiseGrid(48,94);
  for(let y=0;y<n;y++) {
    if (breathe && y && y%64===0) await breathe();
    for(let x=0;x<n;x++) {
      const X=x/n*units,Y=y/n*units,ix=Math.floor(X),iy=Math.floor(Y);
      const rule=(ix+iy)%4;
      // A four-cell diagonal lattice pairs dominoes at right angles, giving a true herringbone bond.
      const horizontal=rule<2, ax=ix-(rule===1?1:0), ay=iy-(rule===3?1:0);
      const u=X-ax, v=Y-ay, edge=Math.min(u,v,(horizontal?2:1)-u,(horizontal?1:2)-v);
      const stone=block((ax+16)%16,(ay+16)%16), grain=rand();
      const mottling=weather(X*.5,Y*.5);
      let paver=137+40*stone+22*mottling+16*(grain-.5);
      if(edge<.045) paver=78+grain*22;
      else if(edge<.105) paver+=22*(u<.105||v<.105?1:-.55);
      const i=4*(y*n+x);
      data[i]=paver;
      data[i+1]=72+112*grain+29*mottling+(rand()>.968?30:0);
      data[i+2]=68+90*grass(X*3,Y*3)+57*grain;
      data[i+3]=255*mottling;
    }
  }
  return data;
}

export async function makeGroundMaps(site, sizes, breathe) {
  const surface = surfaceMask(site, sizes.mask);
  if (breathe) await breathe();
  const detail = await detailPixels(sizes.detail, breathe);
  return {surface, detail};
}
