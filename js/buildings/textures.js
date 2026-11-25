import {grain,surfaceSizes} from './surfaces.js';
import {rng,edges} from './lib.js';

function canvas(size) {
  const c=document.createElement('canvas'); c.width=c.height=size;
  return c.getContext('2d');
}
function tex(ctx,g,repeat) {
  const T=ctx.THREE,t=new T.CanvasTexture(g.canvas);
  t.colorSpace=T.SRGBColorSpace; t.anisotropy=Math.min(ctx.maxAnisotropy,16); t.minFilter=T.LinearMipmapLinearFilter;
  if(repeat) {t.wrapS=t.wrapT=T.RepeatWrapping; t.repeat.setScalar(1/repeat);}
  return t;
}
function noiseLayer(g,rnd,grid,opacity) {
  const n=canvas(grid),im=n.createImageData(grid,grid);
  for(let i=0;i<im.data.length;i+=4) {
    const v=60+rnd()*155;
    im.data[i]=im.data[i+1]=im.data[i+2]=v; im.data[i+3]=255;
  }
  n.putImageData(im,0,0);
  g.save(); g.globalAlpha=opacity; g.imageSmoothingEnabled=true;
  g.drawImage(n.canvas,0,0,g.canvas.width,g.canvas.height); g.restore();
  n.canvas.width=n.canvas.height=1;
}
export function plaster(ctx) {
  const g=canvas(surfaceSizes[ctx.textureQuality].plaster), s=g.canvas.width,r=rng(255);
  g.fillStyle='#f5f3ef'; g.fillRect(0,0,s,s);
  noiseLayer(g,r,12,.09); noiseLayer(g,r,45,.06);
  for(let i=0;i<350;i++) {
    const x=r()*s,y=r()*s,w=(.001+r()*.005)*s,h=r()*.15*s;
    const grad=g.createLinearGradient(x,y,x,y+h); grad.addColorStop(0,'rgba(99,86,70,.055)'); grad.addColorStop(1,'rgba(99,86,70,0)');
    g.fillStyle=grad;g.fillRect(x,y,w,h);
  }
  grain(g,12,()=>r()+r()); return tex(ctx,g,3.4); // assumed plaster repeat in metres
}

// Local runoff below a sill. Alpha tapers at every boundary so the decal has no visible rectangle.
export function runoff(ctx) {
  const g=canvas(surfaceSizes[ctx.textureQuality].runoff),r=rng(681),s=g.canvas.width;
  const im=g.createImageData(s,s);
  const traces=Array.from({length:34},()=>({x:r(),w:.006+r()*.038,h:.12+r()*.86,a:.035+r()*.18}));
  const row=new Float64Array(s);
  for(let y=0;y<s;y++){
    const v=y/s;
    row.fill(0);
    for(const t of traces){
      if(v>t.h)continue;
      const center=t.x+.008*Math.sin(9*v+t.x*15), opacity=t.a*Math.pow(1-v/t.h,1.35);
      const lo=Math.max(0,Math.ceil((center-2*t.w)*s)),hi=Math.min(s,(center+2*t.w)*s);
      for(let x=lo;x<hi;x++){
        const dx=(x/s-center)/t.w;
        row[x]+=Math.exp(-dx*dx*2)*opacity;
      }
    }
    for(let x=0;x<s;x++){
      const u=x/s,i=(y*s+x)*4;
      im.data[i]=86;im.data[i+1]=78;im.data[i+2]=61;
      im.data[i+3]=255*Math.min(.58,row[x])*Math.min(1,u*24,(1-u)*24,v*80)*(r()*.31+.69);
    }
  }
  g.putImageData(im,0,0);return tex(ctx,g);
}
export function glazing(ctx) {
  const g=canvas(surfaceSizes[ctx.textureQuality].windows), c=g.canvas.width/4, r=rng(4291);
  for(let i=0;i<16;i++) {
    g.save();g.translate((i%4)*c,Math.floor(i/4)*c);g.scale(c/256,c/256);
    g.beginPath();g.rect(0,0,256,256);g.clip();
    // Interior exposure varies by apartment. Draw recessed reveals, curtain folds and sliding sash tracks.
    const air=g.createLinearGradient(0,0,70,255);
    air.addColorStop(0,['#434a4a','#646361','#495451','#525553'][i%4]);air.addColorStop(.42,'#393f3e');air.addColorStop(1,'#252e2e');
    g.fillStyle=air;g.fillRect(0,0,256,256);
    g.fillStyle='rgba(16,20,20,.56)'; g.beginPath();g.moveTo(0,0);g.lineTo(256,0);g.lineTo(220,33);g.lineTo(27,33);g.fill();
    g.fillStyle='rgba(159,150,129,.24)';g.fillRect(31,36,8,176);
    const cloth=['180,170,145','152,158,143','191,180,163','138,149,145','163,137,118','178,178,165'][i%6];
    // A back wall, door reveal and a second, distant daylight opening give the uncurtained glass depth.
    g.fillStyle='rgba(136,126,109,.19)';g.fillRect(161,50,40,140);
    g.fillStyle='rgba(24,31,30,.55)';g.fillRect(167,54,34,136);
    if(i%3===0){g.fillStyle='rgba(172,180,165,.25)';g.fillRect(71,65,29,53);g.fillStyle='#434a44';g.fillRect(83,65,2,53);}
    g.fillStyle='rgba(165,158,140,.20)';g.beginPath();g.moveTo(0,251);g.lineTo(75,205);g.lineTo(161,205);g.lineTo(245,251);g.fill();
    if(i%5!==0) {
      for(const side of [0,1]) {
        const w=18+r()*92+(i%6===1?44:0);
        for(let x=0;x<w;x+=1.25) {
          const k=.55+.20*Math.sin(x*.31)+.09*Math.sin(x*.72+.8);
          g.fillStyle='rgba('+cloth+','+k+')';
          const bunched=i%3===1 ? .49:.075, sign=side?-1:1,origin=side?256:0;
          const path=(u,y)=>origin+sign*(u*(1-bunched*Math.exp(-Math.pow((y-143)/61,2)))+.02*(y/256)*u*Math.sin(i));
          const hem=247-3*Math.sin(x*.33);
          g.beginPath();g.moveTo(path(x,7),7);
          for(let y=27;y<hem;y+=21)g.lineTo(path(x,y),y);
          g.lineTo(path(x,hem),hem);g.lineTo(path(x+1.8,hem),hem);
          for(let y=hem-20;y>7;y-=21)g.lineTo(path(x+1.8,y),y);
          g.lineTo(path(x+1.8,7),7);g.closePath();g.fill();
        }
      }
    }
    if(i%4===0 || i%7===0) {
      const h=35+r()*124;
      for(let y=8;y<h;y+=5){g.fillStyle='#989a8f';g.fillRect(5,y,245,2.7);g.fillStyle='#6c736e';g.fillRect(5,y+2.7,245,1);}
    }
    // The incomplete darkness of a second pane and fine gasket are visible even on the low LOD.
    g.fillStyle='rgba(151,178,179,.085)'; g.fillRect(129,4,124,248);
    g.strokeStyle='#232a2b';g.lineWidth=10;g.strokeRect(2,2,252,252);
    g.strokeStyle='#626969';g.lineWidth=2;g.strokeRect(5,5,246,246);
    g.fillStyle='#333a3a';g.fillRect(126,5,5,246);g.fillStyle='#79807d';g.fillRect(130,6,1.4,244);
    g.fillStyle='#292f30';g.fillRect(5,55,246,4);
    g.restore();
  }
  return tex(ctx,g);
}
export function windowUV(id) {
  const x=(id%4)/4,y=1-(Math.floor((id%16)/4)+1)/4, b=.001;
  return [[x+b,y+b],[x+.25-b,y+b],[x+.25-b,y+.25-b],[x+b,y+.25-b]];
}

export function terraceTexture(ctx,drains) {
  const ps=ctx.site.ROOF.polygons, pts=ps.flatMap(p=>p.outer);
  const x0=Math.floor(Math.min(...pts.map(p=>p[0])))-2,y0=Math.floor(Math.min(...pts.map(p=>p[1])))-2;
  const span=Math.ceil(Math.max(Math.max(...pts.map(p=>p[0]))-x0,Math.max(...pts.map(p=>p[1]))-y0))+2;
  const s=surfaceSizes[ctx.textureQuality].screed, g=canvas(s),r=rng(5080), scale=s/span;
  g.fillStyle='#b4a286';g.fillRect(0,0,s,s);
  const U=x=>(x-x0)*scale,V=y=>s-(y-y0)*scale;
  const line=(coords,color,w)=>{
    g.beginPath();coords.forEach(([x,y],i)=>i?g.lineTo(U(x),V(y)):g.moveTo(U(x),V(y)));
    g.strokeStyle=color;g.lineWidth=w*scale;g.stroke();
  };
  noiseLayer(g,r,23,.19);noiseLayer(g,r,75,.13);noiseLayer(g,r,290,.075);
  // assumed screed pours and occasional hand-trowelled repairs
  const joint=3.4;
  for(let row=0;row*joint<span;row++) {
    const y=y0+row*joint, stagger=(row%2)*joint*.5;
    for(let x=x0-joint+stagger;x<x0+span;x+=joint) {
      g.fillStyle=r()<.5?'rgba(244,227,201,'+(r()*.095)+')':'rgba(99,89,77,'+(r()*.095)+')';
      g.fillRect(U(x),V(y+joint),joint*scale,joint*scale);
      line([[x,y],[x+joint,y]],'rgba(74,66,51,.49)',.036);
      line([[x,y],[x,y+joint]],'rgba(81,71,52,.44)',.032);
      if(r()<.065){const w=.35+r()*1.5,h=.22+r()*.7;g.fillStyle='rgba(141,140,129,.30)';g.fillRect(U(x+.4),V(y+1.7),w*scale,h*scale);}
    }
  }
  for(const p of ps) for(const ring of [p.outer,...p.holes]) {
    const path=[...ring,ring[0]];
    for(const [w,alpha] of [[1.55,.075],[.78,.12],[.40,.18]]) line(path,'rgba(75,71,59,'+alpha+')',w);
    for(const {a,f,len} of edges(ring)) if(len>2) {
      for(let t=.3+r();t<len;t+=.4+r()*1.1) {
        const x=a[0]+t*f.x[0], y=a[1]+t*f.x[1], depth=.2+r()*.55;
        line([[x,y],[x-depth*f.z[0],y-depth*f.z[1]]],'rgba(101,96,81,.09)',.1+r()*.26);
      }
    }
  }
  for(const {x,y} of drains) {
    for(let i=0;i<45;i++){
      const a=r()*Math.PI*2,l=.25+r()*1.4;
      line([[x,y],[x+Math.cos(a)*l,y+Math.sin(a)*l]],'rgba(80,78,67,.08)',.045+r()*.09);
    }
  }
  grain(g,11,()=>r()+r());
  const t=tex(ctx,g); t.repeat.set(1/span,1/span); t.offset.set(-x0/span,-y0/span);
  return t;
}
