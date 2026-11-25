import { GeoBuilder, rng } from './util.js';
import { bays, westVerge } from './layout.js';

export function buildRoad(ctx,detail) {
  const {THREE,site}=ctx,{ROAD,COMPOUND}=site;
  const curve=new THREE.CatmullRomCurve3(ROAD.centerline.map(([x,y])=>new THREE.Vector3(x,0,-y)));
  const length=curve.getLength(), steps=Math.ceil(length/(ctx.quality==='low'?2.2:1.1)), half=ROAD.width/2;
  const gb=new GeoBuilder(),prev=[];
  // assumed: dropped kerb at the gate and a narrow strip of concrete flags on the east shoulder.
  const profile=[[-half,0],[half,0],[half+.03,.105],[half+.09,.14],[half+.32,.14],[half+.34,.131],[half+1.46,.131],[half+1.50,.016]];
  for(let i=0;i<=steps;i++) {
    const f=i/steps,p=curve.getPointAt(f),forward=curve.getTangentAt(f),row=[];
    const ramp=THREE.MathUtils.smoothstep(Math.abs(-p.z-COMPOUND.gate.y),COMPOUND.gate.width*.5,COMPOUND.gate.width*.5+1.65);
    for(let j=0;j<profile.length;j++){
      const [across,z]=profile[j];
      const normal=j===2?[-forward.z,.3,forward.x]:[0,1,0];
      row.push(gb.vert([p.x+forward.z*across,.022+z*ramp,p.z-forward.x*across],normal,[across,f*length]));
      if(i&&j) gb.quad(prev[j-1],prev[j],row[j],row[j-1]);
    }
    prev.splice(0,prev.length,...row);
  }
  // Road profile is traversed eastward and then southward, so reverse the winding for its upper surface.
  for(let i=0;i<gb.i.length;i+=3) [gb.i[i+1],gb.i[i+2]]=[gb.i[i+2],gb.i[i+1]];
  const mat=new THREE.MeshStandardMaterial({roughness:.96,transparent:true,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  mat.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,{grain:detail,roadLength:{value:length},halfWidth:{value:half},gateY:{value:COMPOUND.gate.y}});
    sh.vertexShader='varying vec2 roadUV; varying vec2 worldPlan;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n roadUV=uv;worldPlan=vec2(position.x,-position.z);');
    sh.fragmentShader='varying vec2 roadUV; varying vec2 worldPlan;uniform sampler2D grain; uniform float roadLength,halfWidth,gateY;\n'+sh.fragmentShader.replace('#include <map_fragment>',`
      float x=roadUV.x,y=roadUV.y,h=halfWidth;
      float grit=texture2D(grain,worldPlan/1.22).g;
      float stain=texture2D(grain,worldPlan/32.).a*.58+texture2D(grain,worldPlan/7.9).a*.42;
      float tracks=exp(-pow((abs(abs(x)-2.46)-.79)/.38,2.));
      float chipSeal=.59+.64*grit+.31*stain-.065*tracks;
      vec3 asphalt=mix(vec3(.102,.098,.092),vec3(.129,.123,.113),stain)*chipSeal;
      float repair=smoothstep(.63,.72,texture2D(grain,worldPlan*vec2(.31,.14)).a)*smoothstep(.51,.73,stain);
      asphalt*=1.-.12*repair;
      float aa=min(.3,fwidth(x))+.009;
      float center=(1.-smoothstep(.065,.065+aa,abs(x)))*(1.-smoothstep(2.8,2.88,mod(y+1.,8.3)));
      float edge=(1.-smoothstep(.048,.048+aa,abs(abs(x)-(h-.32))));
      edge*=smoothstep(3.9,4.35,abs(worldPlan.y-gateY));
      float wear=clamp(.53+grit*.53-stain*.39,0.,1.);
      asphalt=mix(asphalt,vec3(.72,.69,.59),max(center,edge)*wear);
      if(x>h){
        float pavement=x>h+.32?1.:0.;
        float jointDist=min(abs(fract(y/(pavement>.5?.66:.91)+.5)-.5)*(pavement>.5?.66:.91),abs(x-h-.86));
        float cut=1.-smoothstep(.008,.02+min(.1,fwidth(y)),jointDist);
        vec3 stone=mix(vec3(.28,.266,.23),vec3(.40,.363,.30),stain)*(.79+.33*grit);
        asphalt=stone*(1.-.32*cut)*mix(.87,1.,pavement);
      }
      diffuseColor.rgb=asphalt;
      diffuseColor.a*=smoothstep(.15,18.,min(y,roadLength-y));
    `);
  };
  const road=new THREE.Mesh(gb.build(THREE),mat);road.name=ROAD.name+' with dropped kerb';road.receiveShadow=true;road.renderOrder=-1;
  return road;
}

export function buildCourt(ctx) {
  const {THREE,site}=ctx, rand=rng(115), boxes=[], material=new THREE.MeshStandardMaterial({roughness:.91});
  function box(x,y,z,w,d,h,color){boxes.push({x,y,z,w,d,h,color});}
  const v=westVerge(site);
  // assumed: segmented precast kerbs, enamel bay markings, concrete wheel stops and trench grating.
  for(let y=v.y0; y<v.y1; y+=.9) {
    const len=Math.min(.9,v.y1-y);
    box(v.x1,y+len/2,.08,.16,len-.012,.16,rand()>.55?0xa69f8e:0xb3ac99);
  }
  for(const y of [v.y0,v.y1]) box((v.x0+v.x1)/2,y,.07,v.x1-v.x0,.14,.14,0xb9af9c);
  for(let i=0; i<=bays.count;i++) {
    const x=bays.start+i*bays.width;
    box(x,bays.back-bays.depth/2,.009,.068,bays.depth,.012,0xd6d2bd);
    if(i===bays.count)break;
    box(x+bays.width*.5,bays.back,.009,bays.width,.068,.012,0xceccb8);
    box(x+bays.width*.5,bays.back-.58,.057,1.50,.16,.112,0x827e73);
    for(const off of [-.49,.49])box(x+bays.width*.5+off,bays.back-.58,.114,.19,.146,.011,0xc2b28a);
  }
  const gate=site.COMPOUND.gate;
  for(const x of [gate.x+2.45,gate.x+2.75]){
    box(x,gate.y,.023,.038,gate.width-.36,.04,0x504e48);
  }
  box(gate.x+2.60,gate.y,.013,.30,gate.width-.36,.017,0x484641);
  for(let y=gate.y-gate.width/2+.2;y<=gate.y+gate.width/2-.2;y+=.085)
    box(gate.x+2.60,y,.031,.285,.033,.025,0x858076);
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),material,boxes.length);
  const obj=new THREE.Object3D();
  boxes.forEach(({x,y,z,w,d,h,color},i)=>{
    obj.position.set(x,z,-y);obj.scale.set(w,h,d);obj.updateMatrix();
    mesh.setMatrixAt(i,obj.matrix);mesh.setColorAt(i,new THREE.Color(color));
  });
  mesh.name='Planting kerbs, bay markings, wheel stops and gate drain';mesh.receiveShadow=true;return mesh;
}
