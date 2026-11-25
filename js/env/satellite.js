import { makeCanvas, rng, completeMips } from './util.js';

export const attribution = 'Imagery © Esri, Maxar, Earthstar Geographics';
const base = new URL('../../assets/', import.meta.url);

// Paint the swept footprint, including the oblique façade between roof and footprint.
// Use the median of local apron samples and borrow their fine-grained contrast.
function clearRoofs(image, extent, site) {
  const c=makeCanvas(image.width,image.height), g=c.getContext('2d',{willReadFrequently:true});
  g.drawImage(image,0,0);
  const pixels=g.getImageData(0,0,c.width,c.height).data, rand=rng(739);
  const scale=c.width/(extent.maxX-extent.minX);
  const project=([x,y])=>[(x-extent.minX)*scale,(extent.maxY-y)*scale];
  for(const {polygon,h} of site.NEIGHBOURS) {
    const lower=polygon.map(([x,y])=>[x,y-.36*h]);
    const rings=[polygon,lower,...polygon.map((p,i)=>[p,polygon[(i+1)%polygon.length],lower[(i+1)%polygon.length],lower[i]])];
    const mask=makeCanvas(c.width,c.height), mg=mask.getContext('2d');
    mg.lineJoin='round'; mg.lineWidth=scale*2.2; mg.fillStyle=mg.strokeStyle='#fff';
    for(const ring of rings) {
      mg.beginPath(); ring.map(project).forEach(([x,y],i)=>i?mg.lineTo(x,y):mg.moveTo(x,y));
      mg.closePath(); mg.fill(); mg.stroke();
    }
    const pts=rings.flat().map(project);
    const left=Math.floor(Math.min(...pts.map(p=>p[0]))-scale*3), top=Math.floor(Math.min(...pts.map(p=>p[1]))-scale*3);
    const w=Math.ceil(Math.max(...pts.map(p=>p[0]))-left+scale*3), ht=Math.ceil(Math.max(...pts.map(p=>p[1]))-top+scale*3);
    const samples=[];
    // The traced polygons can have either winding. Test the sample position itself.
    for(const ring of [polygon,lower]) for(let i=0;i<ring.length;i++) {
      const a=ring[i], b=ring[(i+1)%ring.length], dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      for(let j=.7;j<len;j+=1.2) for(const side of [-1,1]) {
        const x=a[0]+(dx*j-dy*side*3.5)/len,y=a[1]+(dy*j+dx*side*3.5)/len;
        if(rings.some(r=>site.pointInRing(x,y,r))) continue;
        const [px,py]=project([x,y]).map(Math.floor), n=4*(py*c.width+px);
        samples.push([pixels[n],pixels[n+1],pixels[n+2]]);
      }
    }
    samples.sort((a,b)=>(a[0]+a[1]+a[2])-(b[0]+b[1]+b[2]));
    const mid=samples[Math.floor(samples.length*.48)] || [108,99,79];
    const tile=makeCanvas(w,ht), tg=tile.getContext('2d'), data=tg.createImageData(w,ht);
    // A contiguous sample of open scrub supplies natural grain without repeating building-sized patterns.
    const donorOrigin=project([81,-19]).map(Math.round);
    const donorWidth=Math.min(w,c.width-donorOrigin[0]), donorHeight=Math.min(ht,c.height-donorOrigin[1]);
    const luma=(x,y)=>{
      const i=4*((donorOrigin[1]+Math.max(0,Math.min(donorHeight-1,y)))*c.width+donorOrigin[0]+Math.max(0,Math.min(donorWidth-1,x)));
      return pixels[i]*.30+pixels[i+1]*.59+pixels[i+2]*.11;
    };
    for(let py=0;py<ht;py++)for(let px=0;px<w;px++){
      const center=luma(px,py),local=(luma(px-6,py)+luma(px+6,py)+luma(px,py-6)+luma(px,py+6))*.25;
      const grain=Math.max(-20,Math.min(20,(center-local)*.46+(local-90)*.18))+(rand()-.5)*3;
      const i=4*(py*w+px);
      for(let ch=0;ch<3;ch++)data.data[i+ch]=mid[ch]+grain;
      data.data[i+3]=255;
    }

    tg.putImageData(data,0,0);
    tg.globalCompositeOperation='destination-in';
    tg.filter='blur(2px)'; tg.drawImage(mask,-left,-top);
    g.drawImage(tile,left,top);
  }
  return c;
}

export async function loadImagery(ctx, apply) {
  const {THREE,site}=ctx, loader=new THREE.TextureLoader();
  const meta=await fetch(new URL('sat.json',base)).then(r=>{if(!r.ok) throw Error(r.statusText); return r.json();});
  const [far,near]=await Promise.all(['z18','z19'].map(key=>loader.loadAsync(new URL('terrain_'+key+'.jpg',base).href)));
  // Average a few square metres of the registered image. Bright clearings and
  // cart tracks receive less brush than the adjoining dark thorn scrub.
  const sample=makeCanvas(256,256), g=sample.getContext('2d',{willReadFrequently:true});
  g.drawImage(near.image,0,0,256,256);
  const pixels=g.getImageData(0,0,256,256).data, e=meta.z19;
  function scrubCover(x,y) {
    const u=Math.floor(256*(x-e.minX)/(e.maxX-e.minX));
    const v=Math.floor(256*(e.maxY-y)/(e.maxY-e.minY));
    if(u<0 || u>=256 || v<0 || v>=256)return 0;
    const i=4*(v*256+u);
    const luminance=.30*pixels[i]+.59*pixels[i+1]+.11*pixels[i+2];
    return 1-THREE.MathUtils.smoothstep(luminance,84,147);
  }
  near.image=clearRoofs(near.image,meta.z19,site);
  for(const texture of [near,far]) {
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(ctx.maxAnisotropy||1,8); completeMips(texture);
  }
  const bounds=k=>new THREE.Vector4(k.minX,k.minY,k.maxX-k.minX,k.maxY-k.minY);
  apply(near,far,bounds(meta.z19),bounds(meta.z18),scrubCover);
  return {ok:true};
}
