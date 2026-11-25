import * as THREE from 'three';
import { rng } from './kit.js';

function surface(w,h=w) {
  const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
  return canvas.getContext('2d');
}
function texture(c,aniso,colour=true) {
  const t=new THREE.CanvasTexture(c.canvas);
  t.colorSpace=colour?THREE.SRGBColorSpace:THREE.NoColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=aniso;
  return t;
}
function grain(c,strength,seed) {
  const image=c.getImageData(0,0,c.canvas.width,c.canvas.height), a=image.data, rand=rng(seed);
  for(let i=0;i<a.length;i+=4) {
    const v=(rand()-.5)*strength;
    for(let j=0;j<3;j++) a[i+j]+=v;
  }
  c.putImageData(image,0,0);
}
const fill=(c,col,x,y,w,h)=>{c.fillStyle=col;c.fillRect(x,y,w,h);};

// A four-storey atlas keeps reveals, aluminium frames and curtains legible at long distances.
// The same paint operations write the relief and roughness masks for the window recesses.
export function facades(q,aniso) {
  const w=q==='low'?512:1024,h=w/2;
  const c=surface(w,h), b=surface(w,h), r=surface(w,h), random=rng(82149);
  for(const ctx of [c,b,r]) ctx.scale(w/800,h/400);
  const layer=(x,y,ww,hh,col,level,rough)=>{
    fill(c,col,x,y,ww,hh);fill(b,level,x,y,ww,hh);fill(r,rough,x,y,ww,hh);
  };
  layer(0,0,800,400,'#e4dfd4','#acacac','#ededed');
  for(let f=0;f<4;f++)for(let bay=0;bay<8;bay++){
    const x=bay*100,y=f*100;
    fill(c,['#ddd9cf','#dedacf','#e3dfd5','#d9d5ca'][bay%4],x,y,100,100);
    const shade=c.createLinearGradient(0,y,0,y+21);shade.addColorStop(0,'rgba(65,52,39,.22)');shade.addColorStop(1,'rgba(65,52,39,0)');
    c.fillStyle=shade;c.fillRect(x,y,100,21);
    const wide=bay%4!==2, sx=x+(wide?15:27), sw=wide?70:46, sy=y+20, sh=wide?57:50;
    layer(sx-2,sy-2,sw+4,sh+5,'#c7c0b5','#e1e1e1','#cccccc');
    layer(sx,sy,sw,sh,'#544f4b','#484848','#969696');
    const pane=(sw-7)/2;
    for(let j=0;j<2;j++){
      const px=sx+2+j*(pane+3), py=sy+3;
      const ref=c.createLinearGradient(px,py,px+pane*.35,py+sh);
      const light=random();ref.addColorStop(0,light>.68?'#858e8b':'#526165');ref.addColorStop(.55,light>.68?'#69746c':'#39494b');ref.addColorStop(1,'#303936');
      fill(c,ref,px,py,pane,sh-5);fill(r,'#545454',px,py,pane,sh-5);
      if(random()>.43){
        const cw=pane*(.28+.57*random());
        fill(c,['#b9ae98','#a29684','#c4bdb1','#949b92'][Math.floor(random()*4)],px,py,cw,sh-6);
        for(let k=1;k<cw;k+=4)fill(c,'rgba(51,45,44,.20)',px+k,py,1.5,sh-6);
      }
      fill(c,'rgba(236,240,227,.36)',px,py,1,sh-5);
    }
    if(bay%4===2)for(let k=0;k<4;k++)layer(sx+1,sy+sh-3-k*7,sw-2,1.5,'#888680','#929292','#b8b8b8');
    layer(sx-3,sy+sh,sw+6,2.8,'#f0e9dc','#e8e8e8','#dedede');
    fill(c,'rgba(67,58,42,.21)',sx-2,sy+sh+3,sw+4,2.5);
    layer(x,y+96,100,4,'#bbb5a9','#b6b6b6','#d9d9d9');
  }
  grain(c,8,21);
  return {map:texture(c,aniso),bumpMap:texture(b,aniso,false),roughnessMap:texture(r,aniso,false)};
}

export function finish(q,aniso,type) {
  const n=q==='low'?128:256,c=surface(n),rand=rng(5300);
  c.scale(n/256,n/256);fill(c,'#e7e4de',0,0,256,256);
  if(type==='render'){
    for(let i=0;i<2200;i++){const a=rand()*.09;fill(c,'rgba(72,68,59,'+a+')',rand()*256,rand()*256,1+rand()*3,1+rand()*8);}
  }else if(type==='terrace'){
    fill(c,'#b8b1a4',0,0,256,256);
    // Overlapping patches of lime wash and dust, continuous across UV seams.
    for(let i=0;i<650;i++){
      const x=rand()*256,y=rand()*256,r=3+rand()**3*35;
      for(const dx of [-256,0,256])for(const dy of [-256,0,256]){
        if(x+dx+r<0||y+dy+r<0||x+dx-r>256||y+dy-r>256)continue;
        const stain=c.createRadialGradient(x+dx,y+dy,0,x+dx,y+dy,r);
        stain.addColorStop(0,i%3?'rgba(240,235,219,.09)':'rgba(78,73,60,.12)');stain.addColorStop(1,'rgba(120,112,94,0)');
        fill(c,stain,x+dx-r,y+dy-r,r*2,r*2);
      }
    }
    for(const k of [0,123]){fill(c,'rgba(88,78,62,.21)',k,0,.9,256);fill(c,'rgba(88,78,62,.21)',0,k,256,.9);}
  }else if(type==='timber'){
    fill(c,'#d9cab3',0,0,256,256);
    for(let k=0;k<260;k++){
      const y=rand()*256,wave=rand()*.95,shift=rand()*6.28;
      c.beginPath();
      for(let x=0;x<=256;x+=8){const py=y+wave*Math.sin(x*Math.PI/64+shift);if(!x)c.moveTo(x,py);else c.lineTo(x,py);}
      c.strokeStyle='rgba(99,75,46,.23)';c.lineWidth=.25+rand();c.stroke();
    }
  }else{
    const stone=type==='stone',tile=type==='tile',cols=tile?4:2,rows=stone?5:tile?4:2;
    const ww=256/cols,hh=256/rows;
    fill(c,stone?'#a19e97':tile?'#abb2ae':'#9e978a',0,0,256,256);
    for(let j=0;j<rows;j++)for(let i=-1;i<cols;i++){
      const x=(i+(stone&&j%2?.5:0))*ww,y=j*hh;
      const v=202+Math.floor(rand()*(stone?31:7)),col='rgb('+v+','+(v-2)+','+(v-6)+')';
      fill(c,col,x+1,y+1,ww-1.6,hh-1.6);
      if(stone) for(let k=0;k<140;k++)fill(c,'rgba(85,77,64,.09)',x+rand()*ww,y+rand()*hh,rand()*10,.7);
    }
  }
  grain(c,type==='render'?13:9,339);
  return texture(c,aniso);
}

// Low-frequency swell and fine interfering ripples are periodic across the tile seams.
export function poolTextures(q,aniso) {
  const n=q==='low'?128:512, normal=surface(n), colour=surface(n);
  const nm=normal.createImageData(n,n), cm=colour.createImageData(n,n);
  const tau=Math.PI*2;
  const cells=22,rand=rng(51120);
  const sites=Array.from({length:cells*cells},()=>[.10+rand()*.8,.10+rand()*.8]);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const x=i/n*tau,y=j/n*tau,s=Math.sin,c=Math.cos;
    const a=7*x+3*y+.9*s(3*y+x), b=5*y-4*x+1.2*s(2*x+y), d=13*y+4*x+1.3*s(3*x-y);
    const nx=.115*c(a)-.055*c(b)+.034*c(d),ny=.05*c(a)+.097*c(b)+.068*c(d);
    const p=4*(j*n+i);nm.data.set([128+nx*127,128+ny*127,255,255],p);
    // Refraction concentrates sunlight along warped cell edges where two wave fronts meet.
    const wx=i/n*cells+.24*s(a)+.15*s(d),wy=j/n*cells+.27*s(b)+.13*s(d);
    const ix=Math.floor(wx),iy=Math.floor(wy);let first=9,second=9;
    for(let cy=iy-1;cy<=iy+1;cy++)for(let cx=ix-1;cx<=ix+1;cx++){
      const site=sites[((cy+cells)%cells)*cells+(cx+cells)%cells];
      const dd=(wx-cx-site[0])**2+(wy-cy-site[1])**2;
      if(dd<first){second=first;first=dd;}else if(dd<second)second=dd;
    }
    const focus=Math.exp(-24*(Math.sqrt(second)-Math.sqrt(first)))*(.45+.55*(.5+.5*s(b)));
    const sun=.4*s(a)+.6*s(b);
    cm.data.set([39+focus*81+sun*5,134+focus*57+sun*7,141+focus*54+sun*7,255],p);
  }
  normal.putImageData(nm,0,0);colour.putImageData(cm,0,0);
  return {normal:texture(normal,aniso,false), caustic:texture(colour,aniso)};
}
export function chainMesh(aniso){
  const c=surface(128);
  for(const slope of [-1,1])for(let t=-128;t<=256;t+=64){
    c.lineWidth=3;c.strokeStyle='#95958b';c.beginPath();c.moveTo(t,0);c.lineTo(t+slope*128,128);c.stroke();
  }
  return texture(c,aniso);
}
