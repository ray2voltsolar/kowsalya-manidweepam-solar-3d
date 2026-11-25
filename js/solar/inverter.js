import * as THREE from 'three';
import {stationRack,rackChannel} from './bos-route.js';
import {Batch,material,powderFinish,labelSheet,plate} from './bos-mesh.js';

const ZINC=0xa4acae, EDGE=0xc5ccc9, SHADOW=0x435054, RUBBER=0x252a2c;
const SHELL=0xd9dcd6, PORCELAIN=0xe4e6df, SIGNAL=0xac3024;

// Equipment envelope, fastenings and support dimensions are assumed generic utility string inverters.
function inverter(b,x,inv,low){
  const {metal,paint,labels}=b;
  const bottom=1.03, mid=1.38,front=.493;
  for(const z of [1.14,1.58])metal.box(x,.089,z,.96,.09,.048,ZINC);
  metal.box(x,.144,mid,.96,.09,.65,SHADOW);
  const fins=low?4:30;
  for(let i=0;i<fins;i++)metal.box(x-.505+i*1.01/(fins-1),.195,mid,.009,.12,.60,0x879295);
  b.body.housing(x,.324,mid,1.05,.31,.70,.061,SHELL,low?1:5);
  b.body.housing(x,.456,mid,1.025,.066,.679,.059,0x4c5554,low?1:4);
  b.body.housing(x,.469,mid,1.018,.050,.671,.058,PORCELAIN,low?1:5);
  // Raised die-cast lid, perimeter keep-screws and a smoked recessed display.
  paint.housing(x+.22,front+.005,mid+.09,.374,.036,.121,.034,0x65716e,low?1:3);
  paint.box(x+.22,front+.025,mid+.093,.307,.012,.079,0x1b2d30);
  paint.box(x+.252,front+.033,mid+.098,.138,.004,.043,0x507675);
  for(let i=0;i<3;i++)paint.rod([x+.166-i*.038,front+.033,mid+.096],[x+.166-i*.038,front+.039,mid+.096],.008,i===0?0x60b97f:0x57615e,low?4:9,.008,true);
  for(const sign of [-1,1]){
    for(const z of [1.10,1.66])metal.rod([x+sign*.449,.488,z],[x+sign*.449,.498,z],.010,0x88918d,6,.010,true,false);
  }
  if(!low){
    // A separate service cover, a folded lower lip and external fin stacks
    // give the casting depth even when seen almost straight on.
    paint.housing(x-.16,.494,1.521,.488,.032,.144,.030,0xcbd0c8,3);
    for(const sign of [-1,1]){
      for(let i=0;i<7;i++)
        metal.box(x+sign*.513,.176+i*.024,1.37,.041,.009,.50,0x929c9c);
      metal.box(x+sign*.493,.196,1.11,.069,.23,.021,0x788786);
      const xx=x-.16+sign*.17;
      metal.rod([xx,.509,1.521],[xx,.514,1.521],.0075,0x929c94,6,.0075,true,false);
    }
    plate(labels,12,x+.252,front+.036,mid+.098,.135,.042);
    plate(labels,7,x-.344,front+.002,1.127,.194,.072);
    plate(labels,7+Number(inv.id.split('-')[1]),x+.282,front+.002,1.586,.258,.084);
    plate(labels,0,x-.35,front+.002,1.204,.124,.043);
  }
  paint.box(x,.306,bottom-.011,.89,.20,.026,0x525b58);
  const inputs=low?3:inv.strings,sideCount=low?4:8;
  for(let i=0;i<inputs;i++){
    const xx=x+.16+i*.030-.27;
    for(let row=0;row<(low?1:2);row++){
      const yy=.307+row*.052;
      metal.rod([xx,yy,bottom-.020],[xx,yy,bottom-.040],.0142,0x757d79,6,.0142,false,false);
      paint.rod([xx,yy,bottom-.038],[xx,yy,bottom-.083],.0116,RUBBER,sideCount,.009);
      const bundle=x+.095+(i-(inputs-1)/2)*.015;
      paint.path([[xx,yy,bottom-.080],[xx,yy,.898],[bundle,.287,.822],[bundle,.234,.740]],.0045,row?0x393d3c:0x25292a,sideCount);
    }
  }
  // Open cable fan disappears behind the lipped cover of the vertical raceway.
  metal.box(x+.098,.216,.456,.237,.071,.56,ZINC);
  metal.box(x+.098,.252,.458,.224,.013,.552,EDGE);
  for(const h of [.30,.63])metal.box(x+.098,.261,h,.239,.012,.016,SHADOW);
  const acX=x-.302;
  metal.rod([acX,.31,1.03],[acX,.31,.982],.036,SHADOW,8,.035,true,false);
  paint.path([[acX,.31,.98],[acX,.31,.90],[acX+.02,.307,.84],[acX+.07,.28,.80],[acX+.07,.24,.30]],.019,RUBBER,low?5:9);
  paint.rod([x-.365,.484,1.32],[x-.365,.510,1.32],.058,0xe1b13c,low?8:20,.058,true);
  paint.rod([x-.365,.507,1.32],[x-.365,.524,1.32],.043,0x803229,low?6:14,.043,true);
  paint.box(x-.365,.535,1.32,.025,.028,.085,SIGNAL);
}
function acdb(b,x,low){
  const {metal,paint,labels}=b;
  b.body.box(x,.234,1.27,.78,.30,.99,0xaeb5b1);
  paint.box(x,.387,1.27,.747,.022,.951,SHADOW);
  paint.box(x,.405,1.27,.732,.032,.935,0xc4c9c2);
  metal.box(x,.249,1.778,.824,.337,.025,EDGE);
  for(const z of [.95,1.58])metal.box(x+.352,.426,z,.030,.026,.084,0x8a9592);
  paint.box(x-.26,.43,1.25,.057,.025,.157,0x41494a);
  metal.box(x-.26,.448,1.23,.022,.030,.114,0x9ea8a3);
  for(let i=0;i<3;i++){
    const xx=x+.125-i*.112;
    paint.rod([xx,.417,1.46],[xx,.434,1.46],.025,SHADOW,low?4:12,.025,true);
    paint.rod([xx,.433,1.46],[xx,.447,1.46],.017,[0x9e3530,0xd5a33f,0x427c91][i],low?4:12,.015,true);
  }
  if(!low){plate(labels,2,x,.423,1.624,.39,.108);plate(labels,0,x+.05,.423,1.06,.26,.085);}
  metal.box(x,.21,.484,.17,.08,.56,ZINC);
  for(let k=0;k<3;k++){
    const xx=x+(k-1)*.052;
    metal.rod([xx,.25,.78],[xx,.25,.726],.020,SHADOW,8,.019,true,false);
    paint.path([[xx,.25,.726],[xx,.25,.64],[xx,.263,.57],[xx,.26,.32]],.013,RUBBER,6);
  }
}
function extinguisher(b,x,y,z,low){
  const {paint,metal,labels}=b, sides=low?6:20;
  metal.box(x,y-.072,z+.11,.09,.08,.25,SHADOW);metal.box(x,y-.016,z-.216,.17,.18,.024,ZINC);
  const profile=[[-.216,.059],[-.202,.083],[-.175,.094],[.135,.094],[.18,.082],[.212,.045],[.216,.024]];
  for(let i=1;i<profile.length;i++){
    const a=profile[i-1],c=profile[i];paint.rod([x,y,z+a[0]],[x,y,z+c[0]],a[1],0xaf2e25,sides,c[1]);
  }
  paint.rod([x,y,z-.089],[x,y,z-.068],.096,0x353b39,sides);
  metal.rod([x,y,z+.214],[x,y,z+.263],.022,0xa08a50,8,.020,true);
  paint.box(x+.033,y,z+.271,.112,.030,.019,SIGNAL);
  paint.path([[x+.08,y,z+.273],[x+.018,y,z+.294],[x-.025,y,z+.284]],.008,SIGNAL,6);
  metal.rod([x-.015,y+.013,z+.240],[x-.015,y+.041,z+.240],.022,EDGE,10,.022,true);
  paint.rod([x-.015,y+.040,z+.240],[x-.015,y+.044,z+.240],.018,0xe9e8d4,10,.018,true);
  paint.path([[x-.021,y,z+.241],[x-.080,y,z+.24],[x-.119,y,z+.185],[x-.127,y+.012,z+.08],[x-.102,y+.06,z-.14]],.009,RUBBER,7);
  if(!low)plate(labels,4,x,y+.096,z+.04,.123,.05);
}
function station(ctx,s,b,low){
  for(const batch of Object.values(b))batch.setFrame(s.x,s.y,s.z,s.normal);
  const {metal,paint,shade,labels,mat}=b;
  const rack=stationRack(ctx.site,s);
  const {xs,cabinet,west,east,nose,short,fire,matLeft,matRight}=rack;
  const width=east-west,mid=(west+east)/2,back=.012,top=y=>2.515-.13*y; // assumed sheet fall
  const wallXs=[...xs];
  if(!short)wallXs.push(cabinet);
  for(const x of wallXs){
    metal.box(x,.044,1.36,.061,.066,2.22,ZINC);
    for(const z of [.57,1.48,2.26]){
      metal.box(x,.015,z,.13,.03,.115,EDGE);
      if(!low)for(const dx of [-.044,.044])metal.rod([x+dx,.03,z],[x+dx,.044,z],.009,0x717a78,6,.009,true,false);
    }
    shade.rod([x,.061,top(.061)-.05],[x,nose-.03,top(nose)-.05],.030,ZINC,4,.030,false,false);
    shade.rod([x,.061,1.97],[x,nose*.78,top(nose*.78)-.064],.023,ZINC,4,.023,false,false);
  }
  if(short){
    // An independent two-leg portal bears the enclosure and the canopy end.
    for(const x of [cabinet-.28,cabinet+.28]){
      metal.box(x,.096,.012,.157,.17,.024,EDGE);
      metal.box(x,.060,1.23,.052,.046,2.44,ZINC);
      if(!low)for(const dy of [-.073,.073])metal.rod([x,.096+dy,.023],[x,.096+dy,.037],.013,SHADOW,6,.013,true,false);
      shade.rod([x,.060,top(.060)-.05],[x,nose-.03,top(nose)-.05],.025,ZINC,4,.025,false,false);
      shade.rod([x,.060,2.01],[x,nose*.76,top(nose*.76)-.061],.019,ZINC,4,.019,false,false);
    }
  }
  const bays=rack.door?[[west,rack.door[0]],[rack.door[1],east]]:[[west,east]];
  for(const [a,e] of bays)for(const z of [1.09,1.59])metal.box((a+e)/2,.081,z,e-a-.055,.053,.052,ZINC);

  // Folded cleats support both horizontal wireways from the wall strut or
  // cabinet portal. The vertical wires enter the glands above these channels.
  for(const x of [...xs,short?cabinet-.28:cabinet]){
    for(const [v,h] of [[.265,.154],[.412,.302]]){
      const a=x-.026,e=x+.026;
      metal.face([[a,.024,h],[e,.024,h],[e,v,h],[a,v,h]],ZINC);
      metal.face([[a,.024,h],[a,v,h],[a,.024,h-.05]],SHADOW);
      metal.face([[e,.024,h-.05],[e,v,h],[e,.024,h]],SHADOW);
    }
  }
  // Assumed 5 mm insulating rubber, with a rolled bevel around the ribbed field.
  const near=.55,far=near+1.20,edge=.024,rad=.015; // assumed moulded edge
  const outline=[[matLeft+rad,near],[matRight-rad,near],[matRight,near+rad],[matRight,far-rad],
    [matRight-rad,far],[matLeft+rad,far],[matLeft,far-rad],[matLeft,near+rad]];
  mat.face(outline.map(([x,y])=>[x,y,low ? .005 : .0038]),0x454845);
  for(let i=0;i<outline.length;i++){
    const a=outline[i],e=outline[(i+1)%outline.length];
    mat.face([[...a,0],[...e,0],[...e,low ? .005 : .0038],[...a,low ? .005 : .0038]],0x353935);
  }
  if(!low){
    // A 1.2 mm crown on the moulded ribs catches grazing daylight at close range.
    const count=106,pitch=(1.20-2*edge)/count;
    for(let i=0;i<count;i++){
      const y=near+edge+i*pitch,left=matLeft+edge,right=matRight-edge;
      mat.face([[left,y,.0038],[right,y,.0038],[right,y+pitch*.23,.005],[left,y+pitch*.23,.005]],0x555953);
      mat.face([[left,y+pitch*.23,.005],[right,y+pitch*.23,.005],[right,y+pitch*.66,.0038],[left,y+pitch*.66,.0038]],0x444844);
    }
  }
  const sx=west,ex=east;
  const prof=[[sx,0]], pitches=Math.ceil((ex-sx)/(low ? .45 : .205)),pitch=(ex-sx)/pitches;
  for(let i=0;i<pitches;i++)for(const [f,h] of [[.14,0],[.21,.025],[.38,.025],[.45,0],[1,0]])prof.push([sx+(i+f)*pitch,h]);
  for(let i=1;i<prof.length;i++){
    const [x,h]=prof[i-1],[u,j]=prof[i];
    const topPts=[[x,back,top(back)+h],[u,back,top(back)+j],[u,nose,top(nose)+j],[x,nose,top(nose)+h]];
    shade.face(topPts,0xaeb9b5);
    shade.face(topPts.map(p=>[p[0],p[1],p[2]-.007]).reverse(),0x9ba5a3);
  }
  shade.box(mid,nose,top(nose)-.025,ex-sx,.023,.053,EDGE);
  shade.box(mid,.09,top(.09)-.05,ex-sx-.08,.046,.064,ZINC);
  for(const x of [sx,ex]) shade.rod([x,back,top(back)-.008],[x,nose,top(nose)-.008],.018,EDGE,4,.018,false,false);
  if(s.wall!=='N'){
    // The end toward the south (west end on a south-facing wall) takes the blades.
    const side=s.wall==='W'?sx:ex,v0=.075,v1=nose-.055;
    for(const v of [v0,v1])shade.box(side,v,1.94,.031,.031,2*(top(v)-1.94),ZINC);
    for(let z=1.57;z<=2.28;z+=.095){
      const a=[side-.036,v0,z+.022],b=[side+.036,v0,z-.016];
      const c=[side+.036,v1,z-.016],d=[side-.036,v1,z+.022];
      shade.face([a,b,c,d],0xb2b9b5);
      shade.face([d,c,b,a].map(([x,y,h])=>[x,y,h-.005]),0x808a87);
      shade.box(side+.035,(v0+v1)/2,z-.026,.01,v1-v0,.024,0x8d9693);
    }
  }
  for(let j=0;j<xs.length;j++)inverter(b,xs[j],ctx.site.INVERTERS.find(i=>i.id===s.inverters[j]),low);
  acdb(b,cabinet,low);
  const logger=xs[0]+.27, lz=1.98;
  paint.housing(logger,.115,lz,.292,.145,.176,.038,SHELL,low?1:3);
  paint.rod([logger-.108,.12,2.062],[logger-.108,.12,2.208],.007,SHADOW,7,.005,true);
  paint.rod([logger+.113,.19,lz-.023],[logger+.113,.195,lz-.023],.006,0x6db78b,7,.006,true);
  if(!low)plate(labels,6,logger+.005,.190,lz,.188,.061);
  metal.path([[logger,.122,1.91],[logger,.122,1.86],[logger+.08,.09,1.82],[logger+.08,.09,1.60]],.009,ZINC,6);
  const signX=xs.at(-1)-.29;
  metal.box(signX,.036,1.998,.33,.072,.072,SHADOW);
  metal.box(signX,.075,1.998,.46,.023,.158,ZINC);
  if(!low)plate(labels,0,signX,.088,1.998,.451,.150);
  metal.box(fire,.105,.81,.062,.21,.075,ZINC);
  metal.box(fire,.029,.81,.12,.058,.16,EDGE);
  extinguisher(b,fire,.294,.71,low);
  for(const ac of [false,true]){
    const points=rackChannel(rack,west+.04,east-.04,ac);
    for(let i=1;i<points.length;i++){
      const [x,y,z]=points[i-1],[u,,h]=points[i],vertical=x===u;
      metal.box((x+u)/2,y,(z+h)/2,vertical ? .070 : Math.abs(u-x)+.07,
        ac ? .14 : .11,vertical?Math.abs(h-z):.055,ac?0x7a8584:ZINC);
    }
  }
}
export function buildInverterStations(ctx){
  const group=new THREE.Group();group.name='Rooftop inverter stations';
  const b={body:new Batch(),metal:new Batch(),paint:new Batch(),shade:new Batch(),labels:new Batch(),mat:new Batch()},low=ctx.quality==='low';
  for(const s of ctx.site.INVERTER_STATIONS)station(ctx,s,b,low);
  const steel=material('Hot dip galvanised frame',.57,.57);
  b.metal.mesh(group,'Station strut frames, glands and base plates',steel);
  b.shade.mesh(group,'Folded canopy, shade louvres and brackets',steel,true,ctx);
  const rubber=material('Ribbed insulating rubber',.94,.015);
  b.mat.mesh(group,'Terrace insulating mats',rubber);
  const finish=powderFinish(ctx);
  b.body.mesh(group,'Die-cast inverter housings and ACDBs',finish,true,ctx);
  b.paint.mesh(group,'Station instruments, cable glands and fittings',finish);
  if(!low)b.labels.mesh(group,'Engraved nameplates and safety labels',labelSheet(ctx.quality,ctx.maxAnisotropy,ctx.site.INVERTERS));
  group.userData.stations=ctx.site.INVERTER_STATIONS.map(s=>({id:s.id,inverters:s.inverters,obstacle:s.obstacle}));
  return {group};
}

