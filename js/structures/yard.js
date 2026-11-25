import { V, placeAt, revolve, tubePath } from './kit.js';
import { box, pipe, bar, edgeBar, quad, rect, edges, mix } from './geometry.js';

const yardW=3.0,yardD=11.5; // assumed compact single-file service compound
function westFacade(site,y){
  let x=Infinity;
  for(const roof of site.ROOF.polygons)for(const [a,b] of edges(roof.outer)){
    if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y))x=Math.min(x,a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));
  }
  return x;
}
export function locateYard(site){
  const {ltPanel}=site.AC_RISER,{treeBelt:t,polygon}=site.COMPOUND;
  // The traced edges are rectilinear. Sample every roof vertex latitude as well as the ends
  // to include all changes of setback over the full length of the proposed enclosure.
  const ys=site.ROOF.polygons.flatMap(p=>p.outer.map(v=>v[1]));
  const yMin=Math.min(...polygon.map(p=>p[1])), yMax=Math.max(...polygon.map(p=>p[1]));
  const near=[];
  for(let d=0;d<yMax-yMin;d+=.5)for(const y of d?[ltPanel.y+d,ltPanel.y-d]:[ltPanel.y]){
    const y0=y-yardD/2-.23,y1=y+yardD/2+.23;
    if(y0<yMin||y1>yMax)continue;
    const levels=[y0,y1,...ys.filter(v=>v>=y0&&v<=y1).flatMap(v=>[v-.001,v+.001])];
    const east=Math.min(...levels.map(py=>westFacade(site,py)));
    if(!Number.isFinite(east))continue;
    const x=Math.min(ltPanel.x,east-yardW/2-.55); // assumed setback from the traced façade
    if(x-yardW/2-.12<t.x1&&x+yardW/2+.12>t.x0&&y1>t.y0&&y0<t.y1)continue;
    if(!rect(x-yardW/2-.2,y0,x+yardW/2+.2,y1).every(p=>site.pointInRing(...p,polygon)))continue;
    near.push({x,y,distance:Math.hypot(x-ltPanel.x,y-ltPanel.y)});
    if(!d)return near[0];
  }
  near.sort((a,b)=>a.distance-b.distance);
  return near[0]||{x:t.x1+yardW/2+.25,y:t.y1-yardD/2+.80}; // assumed NW fallback
}

function fence(B,a,b,h,gate=false){
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]),metal='#828b7e';
  const n=gate?1:Math.ceil(length/2.2);
  for(let k=0;k<=n;k++){
    const p=mix(a,b,k/n);
    pipe(B,'metal',metal,[...p,.13],[...p,h+.09],gate?.044:.031);
    if(k<n)box(B,'paving','#9e9a8e',...p,.045,.18,.18,.16);
  }
  for(const z of [.20,h])pipe(B,'metal',metal,[...a,z],[...b,z],gate?.034:.023);
  B.add('wire',quad([[...a,.2],[...b,.2],[...b,h],[...a,h]],[[0,0],[length*3.7,0],[length*3.7,(h-.2)*3.7],[0,(h-.2)*3.7]]),'#737a71');
  if(gate){
    bar(B,'metal',metal,[...a,.23],[...b,h-.10],.029,.029);
    const latch=mix(a,b,.92);
    box(B,'metal','#535a53',...latch,1.02,.21,.088,.11);
    for(const z of [.45,1.55])pipe(B,'metal','#59635b',[...a,z],[...a,z+.12],.052);
  }
}

function transformer(B,x,y,low){
  const tank='#59665a',dark='#424b44',bright='#737e70';
  box(B,'paving','#b8b1a1',x,y,.14,2.2,2.64,.26);
  for(const s of [-.48,.48])box(B,'metal',dark,x+s,y,.4,.12,2.03,.13);
  box(B,'paint',tank,x,y,.53,1.26,1.63,1.18);
  for(const s of [-1,1]){
    box(B,'paint',dark,x+s*.67,y,.68,.12,1.48,.76);
    for(let k=0;k<(low?10:16);k++){
      const py=y-.67+1.34*k/(low?9:15);
      box(B,'paint',tank,x+s*.76,py,.72,.30,.038,.76);
    }
  }
  box(B,'paint',bright,x,y,1.70,1.42,1.85,.105);
  for(const sx of [-.64,.64])for(const sy of [-.80,-.28,.28,.8])
    pipe(B,'metal',dark,[x+sx,y+sy,1.803],[x+sx,y+sy,1.843],.033,6);
  // Horizontal conservator, end caps and expansion line returning to the tank lid.
  for(const dy of [-.61,.61])box(B,'metal',dark,x+.44,y+dy,1.80,.10,.10,.42);
  pipe(B,'paint',tank,[x+.44,y-.81,2.22],[x+.44,y+.81,2.22],.24,low?12:20);
  for(const dy of [-.77,.77])pipe(B,'paint',bright,[x+.44,y+dy-.025,2.22],[x+.44,y+dy+.025,2.22],.25,16);
  const oil=[[x+.4,y+.81,2.17],[x+.4,y+.96,2.17],[x+.4,y+.96,1.79],[x+.12,y+.73,1.79]];
  B.add('paint',tubePath(oil.map(p=>V(...p)),.045,8,.06,.12),tank);
  for(const k of [-1,0,1]){
    const py=y+k*.42,px=x-.34;
    const profile=[[0,0],[.081,0],[.079,.05]];
    for(let j=0;j<4;j++)profile.push([.057,.055+j*.072],[.107,.07+j*.072],[.060,.108+j*.072]);
    profile.push([.042,.37],[.04,.40],[0,.40]);
    B.add('paint',placeAt(revolve(profile,low?8:14),px,py,1.8),'#765745');
    pipe(B,'metal','#9e8c74',[px,py,2.19],[px,py,2.25],.028);
    const tail=[[px,py,2.24],[px-.20,py,2.37],[px-.49,py,2.25],[px-.58,py,1.34]];
    B.add('paint',tubePath(tail.map(p=>V(...p)),.024,6,.11,.13),'#4c514d');
  }
}
function equipment(B,x,y){
  const shell='#b3b7a8',gasket='#3b453e', frame='#626c62';
  box(B,'paving','#aaa696',x,y,.13,2.22,4.10,.22);
  box(B,'metal','#505951',x,y,.35,1.60,3.75,.25);
  box(B,'paint',shell,x,y,.59,1.63,3.77,1.53);
  box(B,'paint','#a7b1a3',x,y,2.12,1.70,3.87,.12);
  for(const s of [-1,1]){
    const px=x+s*.836;
    for(const dy of [-.38,.65]){
      box(B,'paint',gasket,px,y+dy,.70,.027,.89,1.28);
      box(B,'paint',shell,px+s*.016,y+dy,.728,.029,.84,1.22);
      box(B,'metal','#5c615a',px+s*.044,y+dy+.29,1.15,.044,.058,.16);
      for(const hz of [.92,1.75])box(B,'metal',frame,px+s*.042,y+dy-.38,hz,.041,.047,.10);
    }
    box(B,'paint',gasket,px,y-1.36,.80,.038,.78,1.13);
    for(let i=0;i<11;i++)box(B,'paint',frame,px+s*.026,y-1.36,.83+i*.097,.075,.73,.040);
    box(B,'metal','#727b73',px+s*.038,y+.61,1.49,.048,.41,.33);
    box(B,'glass','#394d4a',px+s*.067,y+.63,1.59,.019,.25,.13);
    for(const [dy,c] of [[.54,'#745850'],[.66,'#77927b']])
      pipe(B,'paint',c,[px+s*.066,y+dy,1.55],[px+s*.079,y+dy,1.55],.027);
  }
  box(B,'paint',gasket,x,y-1.907,.72,1.40,.04,1.22);
  for(let k=0;k<13;k++)box(B,'paint',frame,x,y-1.934,.77+k*.09,1.35,.07,.044);
  pipe(B,'metal',gasket,[x+.34,y+.98,2.23],[x+.34,y+.98,2.78],.079,12);
  pipe(B,'metal',frame,[x+.34,y+.98,2.76],[x+.34,y+.98,2.83],.118,12,.065);
  for(const dx of [-.57,.57])for(const dy of [-1.38,1.38]){
    const p=[[x+dx,y+dy-.08,2.23],[x+dx,y+dy-.08,2.34],[x+dx,y+dy+.08,2.34],[x+dx,y+dy+.08,2.23]];
    B.add('metal',tubePath(p.map(pt=>V(...pt)),.019,5,.035,.085),frame);
  }
}

export function buildYard(ctx,B) {
  const {x,y}=locateYard(ctx.site), hx=yardW/2,hy=yardD/2;
  box(B,'paving','#ada899',x,y,.035,yardW+.16,yardD+.18,.11);
  const ring=rect(x-hx,y-hy,x+hx,y+hy);
  for(const [a,b] of edges(ring))fence(B,a,b,1.86,Math.abs(a[1]-b[1])<.01&&a[1]<y);
  transformer(B,x,y+.39,ctx.quality==='low');
  equipment(B,x,y-3.08);
  // assumed 11 kV / 433 V installation. Separate HT cabinet with individual gasketed doors.
  box(B,'paving','#aaa295',x,y+3.80,.14,2.12,1.50,.20);
  box(B,'paint','#77847b',x,y+3.8,.34,1.79,.99,1.91);
  box(B,'paint','#9ba69a',x,y+3.80,2.25,1.9,1.08,.085);
  for(const px of [x-.43,x+.43]){
    box(B,'paint','#526159',px,y+3.289,.42,.82,.047,1.74);
    box(B,'paint','#a7b0a4',px,y+3.254,.45,.76,.043,1.67);
    box(B,'glass','#485752',px,y+3.226,1.64,.26,.024,.21);
    box(B,'metal','#676d65',px+.25,y+3.215,.96,.039,.046,.19);
    for(let i=0;i<5;i++)box(B,'metal','#7c877c',px,y+3.221,.55+i*.063,.44,.04,.026);
  }
  return {x,y,width:yardW,depth:yardD};
}
