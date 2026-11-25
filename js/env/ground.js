import { makeCanvas, rng, valueNoise, completeMips } from './util.js';
import { ringWidth, westVerge } from './layout.js';
import { loadImagery } from './satellite.js';

const bounds=[-87,-126,151,176]; // covers the entire compound, apron and gate throat
function surfaceMask(ctx, q) {
  const {THREE,site}=ctx, side=q==='low'?1792:2048;
  const c=makeCanvas(side,side), g=c.getContext('2d',{willReadFrequently:true});
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
  const pixels=g.getImageData(0,0,side,side).data;
  const tex=new THREE.DataTexture(pixels,side,side,THREE.RGBAFormat);
  tex.flipY=true;tex.generateMipmaps=false;tex.minFilter=tex.magFilter=THREE.LinearFilter;
  tex.needsUpdate=true;return tex;
}

// Packed repeating detail: R fired/concrete interlock, G mineral aggregate, B turf, A weathering.
// Both the material grain and the bevel survive downsampling through the normal mip chain.
export function detailTexture(ctx,q) {
  const {THREE}=ctx, n=q==='low'?256:512, rand=rng(49);
  const data=new Uint8Array(n*n*4), units=16;
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const X=x/n*units,Y=y/n*units,ix=Math.floor(X),iy=Math.floor(Y);
    const rule=(ix+iy)%4;
    // A four-cell diagonal lattice pairs dominoes at right angles, giving a true herringbone bond.
    const horizontal=rule<2, ax=ix-(rule===1?1:0), ay=iy-(rule===3?1:0);
    const u=X-ax, v=Y-ay, edge=Math.min(u,v,(horizontal?2:1)-u,(horizontal?1:2)-v);
    const stone=valueNoise((ax+16)%16,(ay+16)%16,539,16), grain=rand();
    const mottling=valueNoise(X*.5,Y*.5,203,8);
    let paver=137+40*stone+22*mottling+16*(grain-.5);
    if(edge<.045) paver=78+grain*22;
    else if(edge<.105) paver+=22*(u<.105||v<.105?1:-.55);
    const i=4*(y*n+x);
    data[i]=paver;
    data[i+1]=72+112*grain+29*mottling+(rand()>.968?30:0);
    data[i+2]=68+90*valueNoise(X*3,Y*3,94,48)+57*grain;
    data[i+3]=255*mottling;
  }
  const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;
  t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;
  t.anisotropy=Math.min(ctx.maxAnisotropy||1,8);return completeMips(t);
}

export function buildGround(ctx,onCoverReady) {
  const {THREE}=ctx;
  const uniforms={
    detail:{value:detailTexture(ctx,ctx.quality)}, surface:{value:surfaceMask(ctx,ctx.quality)},
    nearSat:{value:null},farSat:{value:null},nearB:{value:new THREE.Vector4(0,0,1,1)},
    farB:{value:new THREE.Vector4(0,0,1,1)}, satOn:{value:0},
    maskB:{value:new THREE.Vector4(...bounds)},
  };
  let requested=true, ready=false, quality=ctx.quality;
  const mat=new THREE.MeshStandardMaterial({roughness:.98,transparent:true});
  mat.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,uniforms);
    sh.vertexShader='varying vec2 vPlan;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vPlan=vec2(position.x,-position.z);');
    sh.fragmentShader=`varying vec2 vPlan;
    uniform sampler2D detail,surface,nearSat,farSat;
    uniform vec4 nearB,farB,maskB; uniform float satOn;
    float border(vec2 uv, vec2 size) {vec2 e=min(uv,1.-uv)*size;return min(e.x,e.y);}
    float fieldHash(vec2 cell) {
      vec3 h=fract(vec3(cell.xyx)*vec3(.1031,.1030,.0973));
      h+=dot(h,h.yzx+33.33);
      return fract((h.x+h.y)*h.z);
    }
    // Fade unresolved octaves to their mean before they can alias at a shallow angle.
    float fieldNoise(vec2 uv) {
      vec2 i=floor(uv), t=fract(uv);
      t=t*t*(3.-2.*t);
      float n=mix(mix(fieldHash(i),fieldHash(i+vec2(1,0)),t.x),
                  mix(fieldHash(i+vec2(0,1)),fieldHash(i+1.),t.x),t.y);
      vec2 footprint=fwidth(uv);
      return mix(n,.5,smoothstep(.40,1.30,max(footprint.x,footprint.y)));
    }
    `+sh.fragmentShader.replace('#include <map_fragment>',`
      vec2 p=vPlan;
      vec2 nearUV=(p-nearB.xy)/nearB.zw,farUV=(p-farB.xy)/farB.zw;
      vec3 aerial=texture2D(farSat,farUV).rgb;
      float eyeRange=distance(cameraPosition,vec3(p.x,0.,-p.y));
      float groundLevel=1.-smoothstep(18.,83.,eyeRange);
      vec3 closePhoto=texture2D(nearSat,nearUV).rgb;
      // Retain tracks and land-use boundaries at walking height. At this scale
      // an individual aerial pixel is much larger than the mineral texture.
      closePhoto=mix(closePhoto,textureLod(nearSat,nearUV,2.65).rgb,.78*groundLevel);
      aerial=mix(aerial,closePhoto,smoothstep(0.,24.,border(nearUV,nearB.zw)));
      float lum=dot(aerial,vec3(.2126,.7152,.0722));
      float brush=1.-smoothstep(.075,.27,lum);
      mat2 twist=mat2(.83,.557,-.557,.83);
      vec2 grainUV=twist*p;
      float clumps=fieldNoise(p*1.43);
      float ochre=fieldNoise(grainUV*4.7+20.1);
      float grit=fieldNoise(twist*grainUV*10.8-13.6);
      float nearDetail=1.-smoothstep(270.,425.,eyeRange);
      // A few larger grains have an identifiable lit face at print resolution.
      // Warp and jitter their centres so the cells never form rows on the land.
      vec2 stones=grainUV*4.2+vec2(clumps,ochre)*.49;
      vec2 cell=floor(stones);
      vec2 jitter=vec2(fieldHash(cell-31.8),fieldHash(cell+64.2))-.5;
      vec2 delta=(fract(stones)-.5-jitter*.42)*vec2(1.04,1.31);
      float radius=.10+.18*fieldHash(cell+13.35);
      float footprint=max(fwidth(stones.x),fwidth(stones.y));
      float chip=(1.-smoothstep(radius*.34,radius+min(.3,footprint*.43),length(delta)))*
        (1.-smoothstep(.36,1.05,footprint));
      float mineral=.32*(ochre-.5)+.48*(grit-.5)+.13*(clumps-.5)+.31*(chip-.09);
      float leafy=.37*(clumps-.5)-.35*(smoothstep(.54,.83,ochre)-.21)+.21*(grit-.5);
      float sand=texture2D(detail,grainUV/8.31).g-.54;
      float coarseSand=texture2D(detail,twist*grainUV/18.7).g-.54;
      aerial*=1.+nearDetail*(mix(mineral,leafy,brush)+(.33*sand+.24*coarseSand)*groundLevel);
      float cloud=texture2D(detail,p/81.).a*.57+texture2D(detail,p/29.+.17).a*.43;
      vec3 neutral=mix(vec3(.19,.164,.129),vec3(.29,.259,.208),cloud);
      float farBorder=border(farUV,farB.zw);
      vec3 hinterland=neutral;
      if(farBorder<142. && satOn>.5){
        // Carry the character of the open scrub beyond the survey. Irregular
        // transition widths keep the boundary of the square photograph invisible.
        vec2 warp=vec2(fieldNoise(p*.0081),fieldNoise(p*.0127+32.5));
        vec2 bankUV=abs(fract(grainUV/211.+warp*.085)-.5)*2.;
        vec2 bankPlan=vec2(104.,-70.)+bankUV*vec2(87.,136.);
        vec3 regional=textureLod(nearSat,(bankPlan-nearB.xy)/nearB.zw,3.8).rgb;
        hinterland=mix(vec3(.121,.107,.081)*(.83+.32*warp.y),regional,.38);
      }
      float feather=38.+72.*fieldNoise(p*.0093);
      vec3 land=mix(hinterland,aerial,satOn*smoothstep(0.,feather,farBorder));
      vec2 maskUV=(p-maskB.xy)/maskB.zw;
      vec4 mask=textureLod(surface,maskUV,0.);
      vec4 fine=texture2D(detail,mat2(.7071,-.7071,.7071,.7071)*p/1.92);
      float variation=texture2D(detail,p/9.7).a*.12+cloud*.16;
      vec3 soil=mix(vec3(.18,.121,.072),vec3(.30,.235,.156),cloud)*(.82+.32*fine.g);
      // Borrow the colour and small-scale structure of the adjacent dry stream bank.
      vec3 scrub=texture2D(nearSat,(p+vec2(143.7,-42.8)-nearB.xy)/nearB.zw).rgb;
      vec3 earth=texture2D(nearSat,(p+vec2(3.8,-15.2)-nearB.xy)/nearB.zw).rgb;
      vec3 bank=mix(earth,scrub,smoothstep(-114.,-103.,p.y));
      soil=mix(soil,bank*(.81+.25*fine.g),satOn*.82);
      vec3 grass=mix(vec3(.098,.111,.058),vec3(.161,.169,.088),cloud)*(.65+.60*fine.b);
      vec3 pavers=mix(vec3(.227,.168,.126),vec3(.35,.285,.222),cloud)*(.17+1.09*fine.r+variation);
      vec3 cement=vec3( .285,.258,.222)*(.72+variation+.24*fine.g);
      vec2 panel=abs(fract(p/3.6+.5)-.5)*3.6;
      float joint=1.-smoothstep(.005,.014+.26*(fwidth(p.x)+fwidth(p.y)),min(panel.x,panel.y));
      cement*=1.-.22*joint;
      vec3 court=soil;
      court=mix(court,grass,mask.g);
      court=mix(court,pavers*mix(vec3(.57,.46,.41),vec3(1.),smoothstep(.73,.98,mask.r)),smoothstep(.01,.54,mask.r));
      court=mix(court,cement,mask.b);
      diffuseColor.rgb=mix(land,court,mask.a);
      float relief=nearDetail*satOn*(1.-mask.a)*mix(
        .022*ochre+.013*grit+.020*chip,.087*clumps+.044*ochre+.015*grit,brush);
    `).replace('#include <normal_fragment_maps>',`
      #include <normal_fragment_maps>
      // Screen derivatives turn the metre-scale relief into a lighting normal
      // for the real moving sun, without a tiled normal map or more geometry.
      vec3 gx=dFdx(-vViewPosition),gy=dFdy(-vViewPosition);
      vec3 bx=cross(gy,normal),by=cross(normal,gx);
      float jacobian=dot(gx,bx);
      vec3 slope=sign(jacobian)*(dFdx(relief)*bx+dFdy(relief)*by);
      normal=normalize(normal-slope/max(abs(jacobian),1.e-8));
    `).replace('#include <opaque_fragment>',`
      // Fade to the actual directional sky. A low eye sees air along the
      // surface much sooner. The site itself stays outside the transition.
      float raised=smoothstep(4.,80.,cameraPosition.y);
      float range=length(vPlan-vec2(-18.,-32.));
      float air=smoothstep(mix(160.,300.,raised),mix(720.,1700.,raised),range);
      outgoingLight*=mix(vec3(1.),vec3(1.12,1.055,.96),air);
      diffuseColor.a*=1.-air;
      #include <opaque_fragment>
    `);
  };
  const geo=new THREE.PlaneGeometry(5200,5200);geo.rotateX(-Math.PI/2);
  const mesh=new THREE.Mesh(geo,mat);mesh.name='Compound and satellite terrain';mesh.receiveShadow=true;mesh.renderOrder=-4;
  const satellite=loadImagery(ctx,(near,far,nb,fb,cover)=>{
    uniforms.nearSat.value=near;uniforms.farSat.value=far;
    uniforms.nearB.value=nb;uniforms.farB.value=fb;ready=true;uniforms.satOn.value=+requested;
    onCoverReady(cover);
  }).catch(e=>{console.warn('[environment] Baked imagery unavailable',e);return {ok:false};});
  return {mesh,satellite,detail:uniforms.detail,
    setSatelliteVisible(v){requested=!!v;uniforms.satOn.value=+(ready&&requested);},
    setQuality(q){if(q===quality)return;quality=q;
      for(const [uniform,create] of [[uniforms.surface,surfaceMask],[uniforms.detail,detailTexture]]) {
        const old=uniform.value;uniform.value=create(ctx,q);old.dispose();
      }
    }
  };
}
