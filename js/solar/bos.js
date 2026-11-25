import * as THREE from 'three';
import {planRoutes,stationRack,stationLocal,stationPoint,edgeMasts,rackChannel,channelLength} from './bos-route.js';
import {Batch,material,labelSheet,plate} from './bos-mesh.js';

const GI=0xa8afaa, STEEL=0x667274, EDGE=0xc5cbc6, PVC=0xc2c7bc, EPDM=0x363c39;
const DC=.182,AC=.330; // assumed tray centreline heights over screed
const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const add=(a,b,k=1)=>a.map((v,i)=>v+b[i]*k);
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);

function trayFinish(ctx) {
  if(ctx.quality==='low')return material('Folded galvanised steel',.57,.51);
  const size=ctx.quality==='high'?512:256,cv=document.createElement('canvas');
  cv.width=size;cv.height=size/4;
  const c=cv.getContext('2d'),pix=c.createImageData(cv.width,cv.height);
  let seed=149;
  for(let i=0;i<pix.data.length;i+=4){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const n=220+(seed>>>27)*.72;
    pix.data.set([n,n+1,n,255],i);
  }
  c.putImageData(pix,0,0);
  // Upper atlas band is rolled cover sheet, lower band the punched sidewall.
  c.fillStyle='#b0b6b3';c.fillRect(0,0,2,cv.height/2);
  c.fillStyle='#f0f1ee';c.fillRect(2,0,2,cv.height/2);
  for(let i=0;i<10;i++){
    const x=(i+.5)*size/10,y=cv.height*.75;
    c.fillStyle='#707878';c.beginPath();c.roundRect(x-size*.020,y-cv.height*.045,size*.040,cv.height*.09,cv.height*.042);c.fill();
  }
  const map=new THREE.CanvasTexture(cv);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=THREE.RepeatWrapping;
  map.anisotropy=Math.min(ctx.maxAnisotropy||1,8);
  return material('Pressed GI covers and perforated returns',.60,.48,{map});
}

function covered(b,a,e,low,width,axis,rungs){
  const l=dist(a,e);if(l<.002)return;
  const dx=(e[0]-a[0])/l,dy=(e[1]-a[1])/l;
  if(Math.abs(e[2]-a[2])>.001){b.box(a[0],a[1],(a[2]+e[2])/2,axis[0] ? .057 : width,axis[0]?width:.057,l,GI);return;}
  const cross=(p,s,h)=>[p[0]-dy*s,p[1]+dx*s,p[2]+h];
  const r=width/2;
  if(width>.20){
    // Exposed underside of the covered ladder. Alpha-cut crossbars share the
    // AC ladder material without spending triangles on the hidden upper face.
    const n=Math.max(1,Math.round(l/.31));
    rungs.face([cross(a,-r,-.022),cross(a,r,-.022),cross(e,r,-.022),cross(e,-r,-.022)],
      GI,[[0,0],[1,0],[1,n],[0,n]]);
  }
  const profile=low?[[-r,-.024],[-r,.028],[r,.028],[r,-.024]]
    :[[-r,-.024],[-r,.014],[-r+.006,.028],[-r+.018,.035],[r-.018,.035],[r-.006,.028],[r,.014],[r,-.024]];
  for(let i=1;i<profile.length;i++){
    const [s,h]=profile[i-1],[t,k]=profile[i],side=i===1||i===profile.length-1;
    const v=side ? .05 : .55,w=side ? .46 : .96;
    b.face([cross(a,s,h),cross(e,s,h),cross(e,t,k),cross(a,t,k)],side?GI:i===(low?2:4)?0x899596:EDGE,[[0,v],[l/.65,v],[l/.65,w],[0,w]]);
  }
}
function rungMaterial(){
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=64;
  const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,29,4,6);
  const map=new THREE.CanvasTexture(canvas);map.wrapT=THREE.RepeatWrapping;
  return material('Ladder crossbars at site scale',.60,.45,{map,alphaTest:.25,side:THREE.DoubleSide});
}
function ladder(b,a,e,low,rungs,axis){
  const l=dist(a,e);if(l<.002)return;
  const vertical=Math.abs(e[2]-a[2])>.001, dx=(e[0]-a[0])/l,dy=(e[1]-a[1])/l;
  const side=vertical?[-axis[1],axis[0],0]:[-dy,dx,0],up=vertical?[axis[0],axis[1],0]:[0,0,1];
  const at=(t,s,h)=>add(add(lerp(a,e,t),side,s),up,h);
  for(const s of [-.071,.071]){
    b.face([at(0,s,-.022),at(1,s,-.022),at(1,s,.025),at(0,s,.025)],GI);
    b.face([at(0,s,.025),at(1,s,.025),at(1,s+Math.sign(s)*.009,.025),at(0,s+Math.sign(s)*.009,.025)],EDGE);
  }
  const n=Math.max(1,Math.round(l/.31)); // assumed factory rung pitch
  if(low){
    rungs.face([at(0,-.072,-.014),at(0,.072,-.014),at(1,.072,-.014),at(1,-.072,-.014)],GI,
      [[0,0],[1,0],[1,n],[0,n]]);
  }else for(let i=0;i<n;i++){
    const t=(i+.5)/n,k=Math.min(.014/l,.4/n);
    b.face([at(t-k,-.072,-.014),at(t+k,-.072,-.014),at(t+k,.072,-.014),at(t-k,.072,-.014)],GI);
    b.face([at(t-k,-.072,-.024),at(t-k,-.072,-.014),at(t-k,.072,-.014),at(t-k,.072,-.024)],STEEL);
  }
  const cores=low?1:3;
  for(let i=0;i<cores;i++){
    const s=(i-(cores-1)/2)*.034;
    b.rod(at(0,s,.002),at(1,s,.002),low ? .022 : .014,EPDM,low?4:7);
  }
}
function pads(b,a,e,z,low,ac,width){
  const l=dist(a,e),n=Math.max(1,Math.round(l/1.53)); // assumed support spacing
  const alongX=a[1]===e[1],height=a[2]-z-.024;
  for(let i=0;i<n;i++){
    const [x,y]=lerp(a,e,(i+.5)/n);
    // AC brackets cantilever from the unoccupied side of the shared
    // corridor. The DC saddle carries the water line and bonding strip too.
    const neg=ac?-.19:-width/2-.018,pos=ac ? .085 : .23;
    const mid=ac?neg:(neg+pos)/2,across=ac ? .088 : pos-neg+.04;
    const cx=x+(alongX?0:mid),cy=y+(alongX?mid:0),w=alongX ? .12 : across,d=alongX?across:.12;
    if(low){
      // A tapered precast bearer needs only the two flanks and its top at site scale.
      const A=[cx-w/2,cy-d/2,z],B=[cx+w/2,cy-d/2,z],C=[cx+w/2,cy+d/2,z],D=[cx-w/2,cy+d/2,z];
      const upper=[A,B,C,D].map(([u,v])=>[cx+(u-cx)*.78,cy+(v-cy)*.88,z+height]);
      if(ac){
        const a=alongX?[x-.03,y+neg,z+height]:[x+neg,y-.03,z+height];
        const c=alongX?[x+.03,y+pos,z+height]:[x+pos,y+.03,z+height];
        b.face([a,[c[0],a[1],a[2]],c,[a[0],c[1],a[2]]],GI);
      }else b.face(upper,0xa39d91);
      b.face([A,B,upper[1],upper[0]],0xa39d91);b.face([C,D,upper[3],upper[2]],0xa39d91);
    } else {
      b.box(cx,cy,z+.044,w,d,.088,0xa8a393,true);
      // Bent channel saddle; open underside and continuous steel return.
      const top=a[2]-.024,foot=z+.088;
      const pair=(s,h)=>alongX?[[x-.022,y+s,h],[x+.022,y+s,h]]:[[x+s,y-.022,h],[x+s,y+.022,h]];
      const section=[pair(neg,foot),pair(neg,top),pair(pos,top)];
      if(!ac)section.push(pair(pos,foot));
      for(let k=1;k<section.length;k++)b.face([...section[k-1],...section[k].slice().reverse()],k===2?GI:STEEL);
      if(!ac && !(i%2)){
        const clip=(s,h,k)=>alongX?[x+k,y+.215+s,a[2]-.017+h]:[x+.215+s,y+k,a[2]-.017+h];
        const arc=[[-.015,-.009],[-.015,.006],[-.007,.015],[.007,.015],[.015,.006],[.015,-.009]];
        for(let j=1;j<arc.length;j++)b.face([clip(...arc[j-1],-.007),clip(...arc[j-1],.007),clip(...arc[j],.007),clip(...arc[j],-.007)],STEEL);
      }
    }
  }
}
function ribbon(b,a,e,width,colour,tangent=[1,0]){
  const l=dist(a,e);if(l<.001)return 0;
  const v=Math.abs(e[2]-a[2])>.001?[tangent[0]*width/2,tangent[1]*width/2,0]:[-(e[1]-a[1])/l*width/2,(e[0]-a[0])/l*width/2,0];
  b.face([add(a,v,-1),add(e,v,-1),add(e,v),add(a,v)],colour);return l;
}
function protect(b,site,m,report,low){
  const z=site.ROOF.z,[x,y]=m.foot,up=z+site.BUILDING.parapet.height+.041;
  b.misc.box(x,y,z+.06,.40,.40,.12,0xa7a294,true);
  b.masts.box(x,y,z+.132,.26,.26,.025,GI);
  b.masts.rod([x,y,z+.14],[x,y,z+2.24],.038,GI,low?6:12,.031);
  b.masts.rod([x,y,z+2.24],[x,y,z+2.75],.024,EDGE,low?6:12,.018);
  b.masts.rod([x,y,z+2.72],[x,y,z+2.83],.032,STEEL,low?6:12,.058);
  b.masts.rod([x,y,z+2.83],[x,y,z+2.91],.058,EDGE,low?6:12,.023);
  b.masts.rod([x,y,z+2.90],[x,y,z+3.08],.017,EDGE,low?6:12,.001);
  for(let i=0;i<3;i++){
    const a=2.0944*i,dx=Math.cos(a),dy=Math.sin(a);
    b.masts.rod([x+dx*.16,y+dy*.16,z+.13],[x+dx*.033,y+dy*.033,z+.66],.012,GI,low?4:7);
    b.masts.rod([x+dx*.054,y+dy*.054,z+2.82],[x+dx*.072,y+dy*.072,z+2.965],.007,EDGE,5,.002);
  }
  const inside=add(m.wall,m.n,site.BUILDING.parapet.thickness+.052),outside=add(m.wall,m.n,-.055);
  const clamp=add(m.foot,m.n,-.041),toe=add(m.foot,m.n,-.216),tangent=[m.n[1],-m.n[0]];
  const route=[[...clamp,z+.52],[...clamp,z+.145],[...toe,z+.145],[...toe,z+.021],
    [...inside,z+.021],[...inside,up],[...outside,up],[...outside,.36]];
  b.misc.rod([x,y,z+.46],[x,y,z+.50],.043,STEEL,low?6:12);
  for(let i=1;i<route.length;i++)report.earthStripM+=ribbon(b.misc,route[i-1],route[i],.025,0x66736d,tangent);
  for(let h=.8;h<up;h+=low?2.2:1.18)b.misc.box(outside[0],outside[1],h,.06,.06,.022,0x555f60);
  for(const h of [.25,.76])b.misc.box(...inside,z+h,.064,.064,.018,STEEL);
}
function stairSign(b,site,o,low){
  const corners=[[o.x0,o.y0],[o.x1,o.y0],[o.x1,o.y1],[o.x0,o.y1]];
  const station=site.INVERTER_STATIONS.find(s=>s.obstacle===o.id),faces=[];
  // The access door is on the longest usable face with a clear approach.
  for(let i=0;i<4;i++){
    if(station?.wall===['S','E','N','W'][i])continue;
    const a=corners[i],e=corners[(i+1)%4],l=dist(a,e),n=[(e[1]-a[1])/l,(a[0]-e[0])/l];
    const [x,y]=add(lerp(a,e,.5),n,.65);
    const slab=site.ROOF.polygons.some(p=>site.pointInRing(x,y,p.outer)&&!p.holes.some(h=>site.pointInRing(x,y,h)));
    const clear=!site.TABLES.some(t=>x+.7>t.x0&&x-.7<t.x1&&y+.7>t.ySouth&&y-.7<t.yNorth);
    faces.push({a,e,n,l,score:50*Number(slab)+10*Number(clear)+Math.min(5,l)});
  }
  const {a,e,n,l}=faces.sort((a,b)=>b.score-a.score)[0],wall=lerp(a,e,Math.min(l-.20,l*.48+.81)/l);
  const [x,y]=add(wall,n,.022),h=site.ROOF.z+1.74; // assumed eye-level sign on the latch side
  b.misc.box(x,y,h,n[0] ? .018 : .31,n[0] ? .31 : .018,.12,0xb2a170);
  if(!low){const [u,v]=add([x,y],n,.011);plate(b.labels,0,u,v,h,.304,.115,n);}
}
function panel(b,site,normal,low){
  const p=site.AC_RISER.ltPanel;
  for(const batch of [b.misc,b.labels])batch.setFrame(p.x,p.y,p.z,normal);
  b.misc.box(0,0,.08,.97,.64,.16,0xaaa293,true);
  b.misc.box(0,0,.84,.87,.44,1.37,0x8f9893);
  b.misc.box(0,.225,.84,.817,.02,1.30,STEEL);
  b.misc.box(0,.241,.84,.804,.024,1.278,0xb5bcb4);
  b.misc.box(-.32,.268,.81,.031,.035,.173,EPDM);
  for(let i=0;i<3;i++)b.misc.rod([.12-i*.12,.253,1.15],[.12-i*.12,.270,1.15],.023,[0xb34135,0xd6b557,0x507e92][i],8,.02,true);
  if(!low){plate(b.labels,5,0,.255,1.32,.46,.14);plate(b.labels,0,.03,.255,.59,.28,.095);}
  for(const batch of [b.misc,b.labels])batch.setFrame();
}
export function buildBOS(ctx,modules) {
  const {site}=ctx,z=site.ROOF.z,low=ctx.quality==='low',plan=planRoutes(site,modules);
  const group=new THREE.Group();group.name='Rooftop electrical and cleaning services';
  const b={tray:new Batch(),steel:new Batch(),rungs:new Batch(),misc:new Batch(),masts:new Batch(),labels:new Batch()};
  const report={dcTrayM:0,acTrayM:0,dcCableM:0,acCableM:0,earthStripM:0,laCount:0,bridgeCount:0,bridgeSpansM:[],routes:plan.routes};
  const bridges=new Set();
  const route=(points,ac,width=.15,axis=[0,1])=>{
    let sum=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],e=points[i],l=dist(a,e);if(l<.001)continue;
      if(ac)ladder(b.steel,a,e,low,b.rungs,axis);else covered(b.tray,a,e,low,width,axis,b.rungs);
      sum+=l;
    }
    if(ac)report.acTrayM+=sum;else report.dcTrayM+=sum;
    return sum;
  };
  for(const [segments,ac] of [[plan.dc,false],[plan.ac,true]])for(const s of segments){
    const level=z+(ac?AC:DC),a=[...s.a,level],e=[...s.b,level];
    const deck=s.bridge?z+site.BUILDING.parapet.height+(ac ? .30 : .15):level;
    const width=(ac||s.branch) ? .15 : .30; // assumed covered trunk and table branch sizes
    const axis=a[0]===e[0]?[0,1]:[1,0];
    const points=s.bridge?[a,[...s.a,deck],[...s.b,deck],e]:[a,e];route(points,ac,width,axis);
    if(s.bridge){
      const key=[s.a,s.b].join('/');
      if(!bridges.has(key)){
        bridges.add(key);
        report.bridgeSpansM.push(dist(...s.bearings));
        const [start,end]=s.bearings,span=dist(start,end),alongX=a[1]===e[1],mid=lerp(start,end,.5);
        for(const offset of [-.049,.049]){
          b.steel.box(mid[0]+(alongX?0:offset),mid[1]+(alongX?offset:0),deck-.044,alongX?span+.11:.022,alongX ? .022 : span+.11,.043,STEEL);
        }
        for(const [x,y] of s.bearings){
          b.steel.box(x,y,deck-.11,.14,.15,.19,STEEL);
          b.steel.box(x,y,deck-.022,.22,.19,.023,EDGE);
        }
      }
    }else pads(b.misc,a,e,z,low,ac,width);
    if(!ac){
      for(let i=1;i<points.length;i++){
        const p=points[i-1],q=points[i];
        report.earthStripM+=ribbon(b.misc,add(p,[.177,.177,-.026]),add(q,[.177,.177,-.026]),.025,STEEL);
        b.misc.rod(add(p,[.215,.215,-.017]),add(q,[.215,.215,-.017]),.0125,PVC,low?4:7);
      }
    }
  }
  if(!low)for(const {point:[x,y],wx,wy} of plan.turns){
    const a=wy/2,e=wx/2,r=.024,h=z+DC+.039;
    const outline=[[-a+r,-e],[a-r,-e],[a,-e+r],[a,e-r],[a-r,e],[-a+r,e],[-a,e-r],[-a,-e+r]];
    b.tray.face(outline.map(([u,v])=>[x+u,y+v,h]),0x879294);
    for(let i=0;i<outline.length;i++){
      const p=outline[i],q=outline[(i+1)%outline.length];
      b.tray.face([[x+p[0],y+p[1],h-.01],[x+q[0],y+q[1],h-.01],
        [x+q[0],y+q[1],h],[x+p[0],y+p[1],h]],GI);
    }
  }
  report.bridgeCount=bridges.size;
  const taps=new Set();
  for(const bond of plan.tableBonds){
    const [x,y]=add(bond.a,[.177,.177]),end=[bond.b[0],bond.b[1],bond.z-.042];
    const corner=[end[0],end[1],z+DC-.026];
    report.earthStripM+=ribbon(b.misc,[x,y,corner[2]],corner,.025,STEEL)+ribbon(b.misc,corner,end,.025,STEEL);
    if(taps.has(bond.array))continue;taps.add(bond.array);
    const xx=bond.a[0]+.215,yy=bond.a[1]+.215,top=z+.50;
    b.misc.rod([xx,yy,z+DC-.017],[xx,yy,top],.0125,PVC,low?5:8);
    b.misc.rod([xx,yy,top],[xx+.073,yy,top],.016,0x948054,7);
    b.misc.rod([xx+.070,yy,top],[xx+.078,yy,top-.046],.014,0xa19062,7);
    b.misc.rod([xx+.04,yy,top],[xx+.04,yy,top+.035],.008,0x948054,6);
    b.misc.box(xx+.04,yy,top+.04,.061,.014,.013,0x3b6974);
  }
  const {face,normal,landing}=plan,p=site.AC_RISER.ltPanel;
  const duct=add(face,normal,.27),crown=z+site.BUILDING.parapet.height+.11;
  panel(b,site,normal,low);
  const panelFrame={...p,normal},[u]=stationLocal(panelFrame,...duct);
  const side=Math.sign(u)*.435,h=p.z+.50;
  const lower=[...duct,h],bend=[...stationPoint(panelFrame,u,0),h],inlet=[...stationPoint(panelFrame,side,0),h];
  const drop=route([[...landing,z+AC],[...landing,crown],[...duct,crown],lower,bend,inlet],true,.15,normal);
  for(const [a,e] of [[lower,bend],[bend,inlet]])if(dist(a,e)>.3)pads(b.misc,a,e,p.z,low,true,.15);
  for(let h=.72;h<crown;h+=1.17){
    const m=lerp(duct,face,.5);
    b.steel.box(...m,h,normal[0] ? .29 : .208,normal[1] ? .29 : .208,.029,GI);
    b.misc.box(...face,h,normal[0] ? .035 : .241,normal[1] ? .035 : .241,.088,STEEL);
  }
  for(const st of plan.stations){
    const s=site.INVERTER_STATIONS.find(r=>r.id===st.id),rack=stationRack(site,s);
    const [u]=stationLocal(s,...st.entry);
    report.dcTrayM+=channelLength(rackChannel(rack,rack.west+.04,rack.east-.04,false))+.56*rack.xs.length;
    report.acTrayM+=channelLength(rackChannel(rack,rack.west+.04,rack.east-.04,true))+.56;
    for(const ac of [false,true]){
      const rail=stationPoint(s,u,ac ? .342 : .206),h=z+(ac?AC:DC),tail=route([[...st.entry,h],[...rail,h]],ac,ac ? .15 : .30);
      if(ac)for(const ix of rack.xs)
        report.acCableM+=st.acLength+tail+drop+channelLength(rackChannel(rack,u,rack.cabinet,true))+channelLength(rackChannel(rack,ix-.302,rack.cabinet,true))+1.72; // assumed gland tails
    }
  }
  const masts=edgeMasts(site);
  for(const m of masts)protect(b,site,m,report,low);
  report.laCount=masts.length;
  for(const o of site.OBSTACLES.filter(o=>o.type==='headroom'))stairSign(b,site,o,low);
  report.dcCableM=report.routes.reduce((sum,r)=>sum+r.lengthM,0);
  const steel=material('Cable ladder and fastenings',.58,.51,{side:THREE.DoubleSide});
  b.tray.mesh(group,'Covered DC cable trays',trayFinish(ctx));
  b.steel.mesh(group,'AC ladder, cable runs and riser brackets',steel);
  b.rungs.mesh(group,'Ladder crossbars',rungMaterial());
  b.misc.mesh(group,'Earthing, saddle blocks, cleaning pipe and LT panel',material('Ancillary electrical services',.71,.16,{side:THREE.DoubleSide}));
  b.masts.mesh(group,'Lightning air terminals and stays',steel,true,ctx);
  if(!low)b.labels.mesh(group,'Electrical warning plates',labelSheet(ctx.quality,ctx.maxAnisotropy,site.INVERTERS));
  group.userData.arrays=plan.arrays.map(({id,station})=>({id,station}));
  return {group,report};
}
