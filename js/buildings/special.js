import {Batch,box,clearTables,globalFrame as F,inside,panel,pt,tube,wallFrame} from './lib.js';
const steel='#646e6d', concrete='#c1bcaf', chalk='#ded9cd', dark='#4a504e';
function sides(o) {
  const a=[o.x0,o.y0],b=[o.x1,o.y0],c=[o.x1,o.y1],d=[o.x0,o.y1];
  return [[a,b],[b,c],[c,d],[d,a]].map(([p,q],i)=>({f:wallFrame(p,q),len:Math.hypot(q[0]-p[0],q[1]-p[1]),i}));
}
function cap(md,x,y,z,r,color,n) {
  const p=i=>[x+r*Math.cos(i*2*Math.PI/n),y+r*Math.sin(i*2*Math.PI/n),z];
  for(let i=0;i<n;i++)md.face([[x,y,z],p(i),p(i+1)],color);
}
function tank(K,md,x,y,z,r,h,col) {
  // assumed moulded HDPE profile, raised bands, shoulder, manhole and threaded inspection cover
  const n=K.low?16:32, rim=col==='#363b39'?'#404541':col;
  const stations=[[0,.84],[.025,.94],[.062,.98],[.10,1],[.126,.974]];
  for(const f of [.21,.34,.47,.60,.73])stations.push([f-.018,.97],[f-.008,1],[f+.014,1],[f+.027,.97]);
  stations.push([.79,.97],[.83,.95],[.89,.79],[.925,.55],[.94,.37],[.96,.37],[.968,.42],[.991,.42],[1,.39]);
  for(let i=1;i<stations.length;i++) {
    const [a,ra]=stations[i-1],[b,rb]=stations[i];
    tube(md,[x,y,z+a*h],[x,y,z+b*h],ra*r,i>=stations.length-3?dark:rb===1?rim:col,n,rb*r);
  }
  cap(md,x,y,z+h,.39*r,dark,n);
  for(const dy of [-.11,.11])box(md,F,x-.14*r,x+.14*r,y+dy*r-.016,y+dy*r+.016,z+h,z+h+.026,dark);
  // Branch fittings on each vessel terminate at a wall return or a deck penetration.
  const xp=x+r*.83,yp=y+r*.37;
  tube(md,[x+r*.61,yp,z+.84*h],[xp,yp,z+.94*h],.034,'#a3a59a',8);
  tube(md,[xp,yp,z+.94*h],[xp+r*.28,yp,z+.94*h],.034,'#a3a59a',8);
  tube(md,[xp+r*.28,yp,z+.94*h],[xp+r*.28,yp,z+.015],.034,'#9c9e94',8);
  tube(md,[x,y+r*.91,z+h*.14],[x,y+r*1.12,z+h*.14],.053,'#898e82',8);
  tube(md,[x,y+r*1.12,z+h*.14],[x,y+r*1.12,z+.008],.045,'#9c9e94',8);
  box(K.furnitureProxy,F,x-r,x+r,y-r,y+r,z,z+h,'#ffffff');
}
function ladder(md,f,c,z,h) {
  // assumed standoff ladder with handholds extending above the cap
  for(const x of [c-.205,c+.205]){
    tube(md,pt(f,x,z+.22,.21),pt(f,x,z+h+.54,.21),.025,steel,8);
    tube(md,pt(f,x,z+h+.54,.21),pt(f,x,z+h+.59,.10),.025,steel,8);
    tube(md,pt(f,x,z+h+.59,.10),pt(f,x,z+h+.59,-.10),.025,steel,8);
    tube(md,pt(f,x,z+h+.59,-.10),pt(f,x,z+h,-.10),.025,steel,8);
    for(let s=.45;s<h;s+=1.19)tube(md,pt(f,x,z+s,.0),pt(f,x,z+s,.21),.022,steel,7);
  }
  for(let s=.36;s<h+.18;s+=.305)tube(md,pt(f,c-.205,z+s,.21),pt(f,c+.205,z+s,.21),.017,steel,8);
}
function louvre(md,f,c,z,w,h) {
  box(md,f,c-w/2-.036,c+w/2+.036,z-.035,z+h+.035,.001,.046,'#999b90');
  panel(md,f,c-w/2,c+w/2,z,z+h,.049,'#393f3c');
  for(let b=z+.042;b<z+h-.014;b+=.09) {
    md.face([[c-w/2,b,.10],[c+w/2,b,.10],[c+w/2,b+.05,.056],[c-w/2,b+.05,.056]].map(p=>pt(f,...p)),'#9eaaa4');
  }
}
function accessRoom(K,md,o,idx) {
  const {x0,x1,y0,y1,z0:z,h}=o, top=z+h, S=sides(o), w=x1-x0,d=y1-y0;
  box(md,F,x0,x1,y0,y1,z,top-.13,'#cec9bc');
  box(md,F,x0-.018,x1+.018,y0-.018,y1+.018,z+.008,z+.18,'#aaa89c');
  box(md,F,x0-.105,x1+.105,y0-.105,y1+.105,top-.145,top-.032,chalk);
  box(md,F,x0-.11,x1+.11,y0-.11,y1+.11,top-.032,top,'#bdb7a9');
  const station=K.site.INVERTER_STATIONS.find(s=>s.obstacle===o.id);
  const usable=S.filter(s=>!(station&&s.i===2));
  const score=s=>{
    const p=pt(s.f,s.len*.5,0,.65);
    return (inside(K.site,p[0],p[1])?50:0)+(clearTables(K.site,p[0]-.4,p[1]-.4,p[0]+.4,p[1]+.4)?10:0)+Math.min(5,s.len);
  };
  const doorSide=[...usable].sort((a,b)=>score(b)-score(a))[0];
  const {f,len}=doorSide, c=len*.48, dw=Math.min(.98,len-.30),left=c-dw/2,right=c+dw/2;
  // assumed painted flush steel door with pressed panels, hinges, mortice lock and threshold
  box(md,f,left-.068,right+.068,z+.032,z+2.17,.005,.078,dark);
  panel(md,f,left,right,z+.074,z+2.11,.081,idx%3===0?'#74817b':'#828b83');
  for(const [z1,z2] of [[.24,.9],[1.04,1.89]]) {
    box(md,f,left+.09,right-.09,z+z1,z+z2,.082,.095,'#69766f');
    panel(md,f,left+.102,right-.102,z+z1+.014,z+z2-.014,.097,'#78847b');
  }
  for(const hng of [.37,1.68])box(md,f,left+.005,left+.027,z+hng,z+hng+.11,.083,.102,'#48544f');
  box(md,f,right-.14,right-.086,z+.93,z+1.09,.082,.106,'#b8b9a9');
  box(md,f,right-.21,right-.091,z+1.024,z+1.045,.107,.148,steel);
  box(md,f,left-.10,right+.10,z,z+.066,.015,.25,concrete);
  if(doorSide.len>2.8)louvre(md,f,c,z+2.31,.73,.33);
  const other=usable.filter(s=>s!==doorSide).sort((a,b)=>b.len-a.len);
  const vent=other[0];louvre(md,vent.f,vent.len*.56,z+h*.57,Math.min(vent.len-.39,o.type==='lmr'?1.35:.86),o.type==='lmr' ? .75:.48);
  if(!o.tank)return;
  // Choose an accessible landing first. In the west wing only one side has a walkable terrace.
  const findLanding=(frac,half)=>{

    for(const s of [doorSide,...other]) for(const t of [frac,1-frac,.35,.65,.5]) {
      const along=Math.max(half,Math.min(s.len-half,s.len*t));
      if(s===doorSide && along+half>left-.10 && along-half<right+.10)continue;
      const points=[along-half,along,along+half].flatMap(u=>[.17,.52,.85].map(v=>pt(s.f,u,z,v)));
      if(!points.every(([x,y])=>inside(K.site,x,y)&&clearTables(K.site,x-.07,y-.07,x+.07,y+.07)))continue;
      return {s,along};
    }

  };
  const climb=findLanding(.21,.31);
  if(climb)ladder(md,climb.s.f,climb.along,z,h);
  const ports=[];
  for(const s of usable)for(const t of [.13,.87,.30,.70]) {
    const along=s.len*t;
    if(s===doorSide && along>left-.30 && along<right+.30)continue;
    if(climb && s===climb.s && Math.abs(along-climb.along)<.55)continue;
    ports.push({point:pt(s.f,along,z+.22,.20), wall:pt(s.f,along,top+.12,-.24)});
  }
  K.ports.set(o.id,ports);
  const alongX=w>d, long=Math.max(w,d), short=Math.min(w,d),count=long>6?3:2;
  const r=Math.min(.755,short*.35,(long-.40)/(2*count)*.91); // assumed tank capacity from available roof
  const cx=(x0+x1)/2,cy=(y0+y1)/2;
  for(let i=0;i<count;i++) {
    const offset=(i-(count-1)/2)*Math.min(1.86,(long-.36)/count),x=cx+(alongX?offset:0),y=cy+(alongX?0:offset);
    box(md,F,x-r*.95,x+r*.95,y-r*.95,y+r*.95,top,top+.095,'#aaa797');
    tank(K,md,x,y,top+.095,r,Math.min(1.60,r*2.28),i===2?'#aba99a':'#363b39');
    if(i===0)K.manifolds.set(o.id,[x,y+r*.91,top+.12]);
  }
}
function ventBox(md,o) {
  const {x0,x1,y0,y1,z0:z,zTop:top}=o;
  box(md,F,x0,x1,y0,y1,z,z+.49,concrete);
  for(const x of [x0,x1-.19])for(const y of [y0,y1-.19])box(md,F,x,x+.19,y,y+.19,z+.49,top-.12,'#c6c2b3');
  for(const s of sides(o)) for(const h of [.61,.78])box(md,s.f,.17,s.len-.17,z+h,z+h+.067,-.07,-.027,'#898d81');
  box(md,F,x0-.07,x1+.07,y0-.07,y1+.07,top-.12,top,chalk);
}
function screen(K,md,o) {
  const {x0,x1,y0,y1,z0:z,zTop:top}=o,w=x1-x0,d=y1-y0,alongX=w>d;
  const f=alongX?wallFrame([x0,(y0+y1)/2],[x1,(y0+y1)/2]):wallFrame([(x0+x1)/2,y0],[(x0+x1)/2,y1]);
  const l=Math.max(w,d),n=Math.ceil(l/.163); // assumed powder-coated vertical aluminium blades
  for(const h of [z+.13,z+o.h*.49,top-.09])box(md,f,0,l,h,h+.045,-.073,-.028,steel);
  for(let i=0;i<n;i++){
    const a=(i+.5)*l/n;box(md,f,a-.036,a+.036,z+.08,top,-.03,.087,K.facade.louvre);
  }
  const bays=Math.ceil(l/2.4);
  for(let i=0;i<=bays;i++){
    const a=.08+i*(l-.16)/bays;box(md,f,a-.031,a+.031,z,top,-.078,-.023,steel);
    box(md,f,a-.10,a+.10,z,z+.065,-.13,.11,concrete);
  }
}
function shed(md,o) {
  const {x0,x1,y0,y1,z0:z,zTop:top}=o,w=x1-x0;
  // assumed profiled lean-to sheet with a low eave, purlins and open steel posts
  const h=x=>top-.045-.26*(x-x0)/w;
  for(const x of [x0+.12,x1-.12]) {
    for(const y of [y0+.14,(y0+y1)/2,y1-.14])box(md,F,x-.042,x+.042,y-.042,y+.042,z,h(x)-.10,steel);
    box(md,F,x-.042,x+.042,y0+.06,y1-.06,h(x)-.13,h(x)-.045,steel);
  }
  const segments=Math.ceil((y1-y0)/.19);
  for(let i=0;i<segments;i++){
    const y=y0+(y1-y0)*i/segments,p=(y1-y0)/segments;
    for(const [a,b,ha,hb] of [[0,.16,0,.036],[.16,.37,.036,.036],[.37,.53,.036,0],[.53,1,0,0]]) {
      const q=[[x0,y+a*p,h(x0)+ha],[x1,y+a*p,h(x1)+ha],[x1,y+b*p,h(x1)+hb],[x0,y+b*p,h(x0)+hb]];
      md.face(q,'#708b78');md.face([...q].reverse().map(([x,y,z])=>[x,y,z-.007]),'#828c80');
    }
  }
}
export function roofFurniture(K) {
  for(const [idx,o] of K.site.OBSTACLES.entries()) {
    const md=new Batch(K.THREE);
    md.skyAccess=(x,y,z,n)=>n[2]<-.55 ? .28:Math.min(.86,.54+.42*(z-o.z0));
    box(K.furnitureProxy,F,o.x0,o.x1,o.y0,o.y1,o.z0,o.zTop,'#ffffff');
    if(o.type==='headroom'||o.type==='lmr')accessRoom(K,md,o,idx);
    if(o.type==='vent')ventBox(md,o);
    if(o.type==='screen')screen(K,md,o);
    if(o.type==='shed')shed(md,o);
    if(o.type==='tank'){
      const cx=(o.x0+o.x1)/2,cy=(o.y0+o.y1)/2,r=Math.min(o.x1-o.x0,o.y1-o.y0)*.41;
      box(md,F,o.x0,o.x1,o.y0,o.y1,o.z0,o.z0+.165,concrete);
      tank(K,md,cx,cy,o.z0+.165,r,o.h-.165,'#566e75');
    }
    const mesh=md.mesh(o.id+' · '+o.type,K.mats.equipment,'roof-furniture');
    mesh.userData.obstacleId=o.id;mesh.userData.block=o.block; K.furniture.add(mesh);
  }
}
