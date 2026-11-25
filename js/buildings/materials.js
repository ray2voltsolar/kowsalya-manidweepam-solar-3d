import {plaster,glazing,terraceTexture,runoff} from './textures.js';
export function materials(ctx,drains) {
  const T=ctx.THREE;
  // A one-dimensional light-access map keeps the sky fill out of deep shafts and soffits.
  const ramp=new Uint8Array(256*4);
  for(let i=0;i<256;i++)ramp.set([i,i,i,255],i*4);
  const ambient=new T.DataTexture(ramp,256,1);ambient.channel=1;ambient.magFilter=T.LinearFilter;ambient.needsUpdate=true;
  const make=props=>new T.MeshStandardMaterial({vertexColors:true,aoMap:ambient,...props});
  const stucco=plaster(ctx);
  const g=document.createElement('canvas'); g.width=256;g.height=160;
  const d=g.getContext('2d');d.fillStyle='#c2c3b9';d.fillRect(0,0,256,160);
  d.fillStyle='#515957';d.beginPath();d.arc(90,80,63,0,2*Math.PI);d.fill();
  d.fillStyle='#252c2d';for(let k=0;k<4;k++){d.save();d.translate(90,80);d.rotate(k*Math.PI/2+.3);d.beginPath();d.ellipse(21,8,27,12,.65,0,Math.PI*2);d.fill();d.restore();}
  d.strokeStyle='#979b92';d.lineWidth=1.7;for(let rad=11;rad<64;rad+=5){d.beginPath();d.arc(90,80,rad,0,Math.PI*2);d.stroke();}
  for(let k=0;k<10;k++){const a=k*Math.PI/5;d.beginPath();d.moveTo(90,80);d.lineTo(90+61*Math.cos(a),80+61*Math.sin(a));d.stroke();}
  d.fillStyle='#626966';d.fillRect(171,20,2,119);for(let y=29;y<120;y+=6)d.fillRect(184,y,42,2);
  for(const x of [8,246])for(const y of [8,152]){d.fillStyle='#696b64';d.fillRect(x,y,2,2);}
  const fan=new T.CanvasTexture(g);fan.colorSpace=T.SRGBColorSpace; fan.anisotropy=Math.min(ctx.maxAnisotropy||1,8);
  return {
    stucco:make({shadowSide:T.DoubleSide,map:stucco,bumpMap:stucco,bumpScale:.022,roughness:.9}),
    fittings:make({roughness:.57,metalness:.22}),
    windows:make({shadowSide:T.DoubleSide,map:glazing(ctx),metalness:.29,roughness:.18,envMapIntensity:.68}),
    balustrade:make({forceSinglePass:true,side:T.DoubleSide,transparent:true,opacity:.29,depthWrite:false,metalness:.24,roughness:.15,envMapIntensity:.83}),
    fans:make({map:fan,roughness:.72,metalness:.11}),
    terrace:make({shadowSide:T.DoubleSide,map:terraceTexture(ctx,drains),roughness:.92,bumpMap:stucco,bumpScale:.026}),
    stains:make({map:runoff(ctx),transparent:true,depthWrite:false,roughness:1,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),
    equipment:make({map:stucco,roughness:.67,metalness:.06}),
    proxy:new T.MeshBasicMaterial({colorWrite:false,depthWrite:false,side:T.DoubleSide})
  };
}
