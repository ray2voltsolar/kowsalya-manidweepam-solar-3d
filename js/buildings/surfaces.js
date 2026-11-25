// The phone and desktop share artwork resolution. Only the site-wide screed map
// needs extra texels in the high tier.
const medium={
  plaster:512,windows:1024,runoff:256,screed:1536,fanWidth:256,fanHeight:160,
  neighbourFacade:1024,masonry:256,water:512,chainLink:128,
};
export const surfaceSizes={medium,high:{...medium,screed:2048}};

export function grain(g,strength,sample) {
  // Tile fine, zero-mean grain in the compositor. Reading the entire terrace back
  // to JavaScript for this pass used to allocate a second multi-megapixel surface.
  const scratch=document.createElement('canvas');scratch.width=scratch.height=128;
  const tile=scratch.getContext('2d'),noise=tile.createImageData(128,128);
  for(let i=0;i<noise.data.length;i+=4){
    const v=sample()*strength;
    noise.data[i]=noise.data[i+1]=noise.data[i+2]=v;
    noise.data[i+3]=255;
  }
  tile.putImageData(noise,0,0);
  const {width,height}=g.canvas;
  g.save();g.resetTransform();
  g.globalCompositeOperation='difference';
  g.fillStyle=g.createPattern(tile.canvas,'repeat');g.fillRect(0,0,width,height);
  g.globalCompositeOperation='lighter';
  g.fillStyle='rgb('+strength+' '+strength+' '+strength+')';g.fillRect(0,0,width,height);
  g.restore();
  tile.canvas.width=tile.canvas.height=1;
}
