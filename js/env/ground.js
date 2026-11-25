import { completeMips, releaseBitmapUpload } from './util.js';
import { bounds } from './layout.js';
import { readPack, packedTexture } from './procedural-cache.js';
import { loadImagery } from './satellite.js';

async function prepareGroundMaps(ctx) {
  const { THREE, site } = ctx;
  if (typeof DecompressionStream === 'function') {
    try {
      const pack = await readPack('ground-materials');
      // Large uniform regions of the surface mask can bypass megabytes of stream decoding.
      const surface=pack.surfaceRuns;
      let w=surface.width,h=surface.height;
      const levels=surface.levels.map(bytes=>{
        const runs=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
        const pixels=new Uint32Array(w*h);
        let pos=0;
        for(let i=0;i<runs.byteLength;i+=8){
          const color=runs.getUint32(i,true), count=runs.getUint32(i+4,true);
          if(count===1)pixels[pos++]=color;
          else {pixels.fill(color,pos,pos+count);pos+=count;}
        }
        w=Math.max(1,w>>1);h=Math.max(1,h>>1);
        return new Uint8Array(pixels.buffer);
      });
      const mask = packedTexture(THREE, {...surface,levels}, true);
      const detail = packedTexture(THREE, pack.detail, false);
      detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
      mask.anisotropy = detail.anisotropy = Math.min(ctx.maxAnisotropy,16);
      // Restoration rebuilds both textures. Release the 2048px CPU-side pyramid after upload.
      for (const texture of [mask,detail]) texture.onUpdate = () => {
        for (const level of texture.mipmaps) level.data = null;
        texture.image.data = null;
        texture.onUpdate = null;
      };
      return {mask,detail};
    } catch { /* Regenerate locally on browsers without streaming gzip support. */ }
  }
  // Both texture tiers use the original medium/high resolution for these two maps.
  const sizes = {mask: 2048, detail: 512};
  const footprint = {COMPOUND: site.COMPOUND, ROOF: {polygons: site.ROOF.polygons}};
  let result;
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    let worker;
    try {
      worker = new Worker(new URL('./ground-worker.js', import.meta.url), {type: 'module'});
      result = await new Promise((resolve, reject) => {
        worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data);
        worker.onerror = reject;
        worker.postMessage({site: footprint, sizes});
      });
    } catch { /* Older WebViews can expose Worker but lack module-worker canvas support. */ }
    finally { worker?.terminate(); }
  }
  if (!result) {
    await ctx.breathe();
    const {makeGroundMaps} = await import('./ground-maps.js');
    result = await makeGroundMaps(footprint, sizes, ctx.breathe);
  }
  let mask;
  if (result.levels) {
    mask = new THREE.Texture(result.levels[0]);
    mask.mipmaps = result.levels; mask.flipY = false; mask.generateMipmaps = false;
    releaseBitmapUpload(mask);
  } else {
    mask = completeMips(new THREE.CanvasTexture(result.surface));
    if (mask.image.close) releaseBitmapUpload(mask);
  }
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.anisotropy = Math.min(ctx.maxAnisotropy, 16);
  mask.needsUpdate = true;
  const detail = new THREE.DataTexture(result.detail, sizes.detail, sizes.detail, THREE.RGBAFormat);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.magFilter = THREE.LinearFilter;
  detail.anisotropy = mask.anisotropy;
  completeMips(detail);
  return { mask, detail };
}

export function buildGround(ctx) {
  const {THREE}=ctx;
  const uniforms={
    detail:{value:null}, surface:{value:null}, hasMaps:{value:0}, hasNear:{value:0}, hasFar:{value:0},
    nearSat:{value:null},farSat:{value:null},nearB:{value:new THREE.Vector4(0,0,1,1)},
    farB:{value:new THREE.Vector4(0,0,1,1)}, satOn:{value:0},
    maskB:{value:new THREE.Vector4(...bounds)},
  };
  let requested=true, quality=ctx.quality;
  const mat=new THREE.MeshStandardMaterial({roughness:.98,transparent:true});
  mat.customProgramCacheKey=()=>quality==='low'?'ground-phone':'ground-full';
  mat.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,uniforms);
    sh.vertexShader='varying vec2 vPlan;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vPlan=vec2(position.x,-position.z);');
    sh.fragmentShader=`varying vec2 vPlan;
    uniform sampler2D detail,surface,nearSat,farSat;
    uniform vec4 nearB,farB,maskB; uniform float satOn,hasMaps,hasNear,hasFar;
    ${quality==='low'?'#define GROUND_PHONE':''}
    vec2 planDx,planDy;
    float widthAt(vec2 uv){return max(abs(uv.x),abs(uv.y));}

    float border(vec2 uv, vec2 size) {vec2 e=min(uv,1.-uv)*size;return min(e.x,e.y);}
    float fieldHash(vec2 cell) {
      vec3 h=fract(vec3(cell.xyx)*vec3(.1031,.1030,.0973));
      h+=dot(h,h.yzx+33.33);
      return fract((h.x+h.y)*h.z);
    }
    // Fade unresolved octaves to their mean before they can alias at a shallow angle.
    float fieldNoise(vec2 uv, float scale) {
      vec2 i=floor(uv), t=fract(uv);
      t=t*t*(3.-2.*t);
      float n=mix(mix(fieldHash(i),fieldHash(i+vec2(1,0)),t.x),
                  mix(fieldHash(i+vec2(0,1)),fieldHash(i+1.),t.x),t.y);
      vec2 footprint=(abs(planDx)+abs(planDy))*scale;
      return mix(n,.5,smoothstep(.40,1.30,max(footprint.x,footprint.y)));
    }
    `+sh.fragmentShader.replace('#include <map_fragment>',`
      vec2 p=vPlan;
      planDx=dFdx(p);planDy=dFdy(p);
      vec2 nearUV=(p-nearB.xy)/nearB.zw, farUV=(p-farB.xy)/farB.zw;
      float farBorder=border(farUV,farB.zw), nearBorder=border(nearUV,nearB.zw);
      float eyeRange=distance(cameraPosition,vec3(p.x,0.,-p.y));
      float groundLevel=1.-smoothstep(18.,83.,eyeRange);
      float nearDetail=1.-smoothstep(270.,425.,eyeRange);
      vec3 land=vec3(.209,.175,.105); // linear RGB from the native terrain mean
      float relief=0.;
      vec2 maskUV=(p-maskB.xy)/maskB.zw;
      vec4 mask=vec4(0.);
      if(hasMaps>.5 && border(maskUV,maskB.zw)>0.)
        mask=textureGrad(surface,maskUV,planDx/maskB.zw,planDy/maskB.zw);
      mat2 twist=mat2(.83,.557,-.557,.83);
      vec2 grainUV=twist*p;
      float cloud=.5;
      if(hasMaps>.5 && (mask.a>0. || satOn<.5))
        cloud=textureGrad(detail,p/81.,planDx/81.,planDy/81.).a*.57+
              textureGrad(detail,p/29.+.17,planDx/29.,planDy/29.).a*.43;
      if(mask.a<1.){
        if(satOn>.5){
          if(hasFar>.5 && farBorder>0. && (nearBorder<24. || hasNear<.5))
            land=textureGrad(farSat,farUV,planDx/farB.zw,planDy/farB.zw).rgb;
          if(hasNear>.5 && nearBorder>0.){
            vec3 nativePhoto=textureGrad(nearSat,nearUV,planDx/nearB.zw,planDy/nearB.zw).rgb;
            land=mix(land,nativePhoto,smoothstep(0.,24.,nearBorder));
          }
          if(hasMaps>.5 && nearDetail>0. && farBorder>0.){
            float brush=1.-smoothstep(.075,.27,dot(land,vec3(.2126,.7152,.0722)));
            float clumps=fieldNoise(p*1.43,1.43);
            float ochre=fieldNoise(grainUV*4.7+20.1,4.7);
            float sand=textureGrad(detail,grainUV/8.31,twist*planDx/8.31,twist*planDy/8.31).g-.54;
            #ifdef GROUND_PHONE
              float grit=.5+sand;
              float sandGrain=.49*sand;
            #else
              float grit=fieldNoise(twist*grainUV*10.8-13.6,10.8);
              float coarse=textureGrad(detail,twist*grainUV/18.7,twist*twist*planDx/18.7,twist*twist*planDy/18.7).g-.54;
              float sandGrain=.33*sand+.24*coarse;
            #endif
            vec2 stones=grainUV*4.2+vec2(clumps,ochre)*.49;
            vec2 cell=floor(stones), jitter=vec2(fieldHash(cell-31.8),fieldHash(cell+64.2))-.5;
            vec2 delta=(fract(stones)-.5-jitter*.42)*vec2(1.04,1.31);
            float radius=.10+.18*fieldHash(cell+13.35);
            float footprint=4.2*max(widthAt(twist*planDx),widthAt(twist*planDy));
            float chip=(1.-smoothstep(radius*.34,radius+min(.3,footprint*.43),length(delta)))*
                       (1.-smoothstep(.36,1.05,footprint));
            float mineral=.32*(ochre-.5)+.48*(grit-.5)+.13*(clumps-.5)+.31*(chip-.09);
            float leafy=.37*(clumps-.5)-.35*(smoothstep(.54,.83,ochre)-.21)+.21*(grit-.5);
            land*=1.+nearDetail*(mix(mineral,leafy,brush)+sandGrain*groundLevel);
            relief=nearDetail*(1.-mask.a)*mix(.022*ochre+.013*grit+.020*chip,.087*clumps+.044*ochre+.015*grit,brush);
          }
          // Beyond the photograph only the regional colour and the atmospheric fade remain.
          if(hasNear>.5 && hasFar>.5 && farBorder<110.){
            vec2 warp=vec2(fieldNoise(p*.0081,.0081),fieldNoise(p*.0127+32.5,.0127));
            vec2 bankUV=abs(fract(grainUV/211.+warp*.085)-.5)*2.;
            vec2 bankPlan=vec2(104.,-70.)+bankUV*vec2(87.,136.);
            vec3 regional=textureLod(nearSat,(bankPlan-nearB.xy)/nearB.zw,3.8).rgb;
            vec3 hinterland=mix(vec3(.121,.107,.081)*(.83+.32*warp.y),regional,.38);
            float blend=0.;
            if(farBorder>0.) blend=smoothstep(0.,38.+72.*fieldNoise(p*.0093,.0093),farBorder);
            land=mix(hinterland,land,blend);
          }
        } else if(hasMaps>.5 && (hasNear>.5 || hasFar>.5 || satOn<0.))
          land=mix(vec3(.19,.164,.129),vec3(.29,.259,.208),cloud);
      }
      if(mask.a>0.){
        mat2 diagonal=mat2(.7071,-.7071,.7071,.7071);
        vec4 fine=textureGrad(detail,diagonal*p/1.92,diagonal*planDx/1.92,diagonal*planDy/1.92);
        float variation=textureGrad(detail,p/9.7,planDx/9.7,planDy/9.7).a*.12+cloud*.16;
        vec3 court=mix(vec3(.18,.121,.072),vec3(.30,.235,.156),cloud)*(.82+.32*fine.g);
        if(satOn>.5 && hasNear>.5 && max(mask.r,max(mask.g,mask.b))<1.){
          float f=smoothstep(-114.,-103.,p.y);
          vec2 uvA=nearUV+vec2(3.8,-15.2)/nearB.zw, uvB=nearUV+vec2(143.7,-42.8)/nearB.zw;
          vec3 bank=textureGrad(nearSat,f==1.?uvB:uvA,planDx/nearB.zw,planDy/nearB.zw).rgb;
          if(f>0. && f<1.) bank=mix(bank,textureGrad(nearSat,uvB,planDx/nearB.zw,planDy/nearB.zw).rgb,f);
          court=mix(court,bank*(.81+.25*fine.g),.82);
        }
        vec3 grass=mix(vec3(.098,.111,.058),vec3(.161,.169,.088),cloud)*(.65+.60*fine.b);
        vec3 pavers=mix(vec3(.227,.168,.126),vec3(.35,.285,.222),cloud)*(.17+1.09*fine.r+variation);
        vec3 cement=vec3(.285,.258,.222)*(.72+variation+.24*fine.g);
        vec2 panel=abs(fract(p/3.6+.5)-.5)*3.6;
        vec2 span=max(abs(planDx)+abs(planDy),vec2(.001));
        vec2 joint=(1.-smoothstep(vec2(.005),vec2(.014)+.5*span,panel))*min(vec2(1.),.025/span);
        cement*=1.-.22*max(joint.x,joint.y);
        court=mix(court,grass,smoothstep(.08,.92,mask.g));
        court=mix(court,pavers*mix(vec3(.57,.46,.41),vec3(1.),smoothstep(.73,.98,mask.r)),smoothstep(.09,.64,mask.r));
        court=mix(court,cement,smoothstep(.08,.92,mask.b));
        land=mix(land,court,mask.a);
      }
      diffuseColor.rgb=land;
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
  let generation=0;
  function loadTextures() {
    const revision=++generation;
    const satellite=loadImagery(ctx,(key,texture,extent)=>{
      if(revision!==generation){texture.dispose();return;}
      const near=key==='z19';
      uniforms[near?'nearSat':'farSat'].value=texture;
      uniforms[near?'nearB':'farB'].value=extent;
      uniforms[near?'hasNear':'hasFar'].value=1;
      uniforms.satOn.value=requested?1:-1;
      ctx.invalidate();
    });
    const mapsReady=prepareGroundMaps(ctx).then(({mask,detail})=>{
      if(revision!==generation){mask.dispose();detail.dispose();return;}
      uniforms.surface.value=mask;uniforms.detail.value=detail;uniforms.hasMaps.value=1;
      ctx.invalidate();
    });
    return {satellite,mapsReady};
  }
  const loads=loadTextures();
  ctx.renderer?.domElement.addEventListener('webglcontextlost',()=>{
    generation++;
    for(const key of ['nearSat','farSat','surface','detail']){
      uniforms[key].value?.dispose();
      uniforms[key].value=null;
    }
    for(const key of ['hasNear','hasFar','hasMaps','satOn'])uniforms[key].value=0;
  });
  ctx.renderer?.domElement.addEventListener('webglcontextrestored',()=>{
    loadTextures();
    ctx.invalidate();
  });
  return {mesh,...loads,detail:uniforms.detail,
    setSatelliteVisible(v){requested=!!v;uniforms.satOn.value=requested?+(uniforms.hasFar.value || uniforms.hasNear.value):-1;ctx.invalidate();},
    setQuality(q){if(quality!==q){quality=q;mat.needsUpdate=true;}}
  };
}
