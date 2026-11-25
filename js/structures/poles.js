import { V, catenary, wireTube, placeAt, revolve } from './kit.js';
import { mix, box, pipe, bar } from './geometry.js';

// Pin profile and parabolic conductors retained from the existing pole builder.
const insulator=[[0,0],[.035,0],[.040,.025],[.085,.045],[.050,.070],[.070,.090],[.042,.115],[.055,.13],[.03,.16],[0,.178]];
const galv='#91968f';
function lamp(B,x,y,h,dx,dy) {
  // assumed cast base, tapered galvanised shaft, outreach bracket and sealed LED lantern.
  box(B,'render','#a69c85',x,y,.02,.41,.41,.17);
  box(B,'metal','#717970',x,y,.19,.265,.265,.06);
  pipe(B,'metal',galv,[x,y,.24],[x,y,h],.093,10,.048);
  box(B,'metal','#707771',x,y-.084,.55,.105,.027,.27);
  const knee=[x+dx*.49,y+dy*.49,h+.35],end=[x+dx*1.19,y+dy*1.19,h+.38];
  pipe(B,'metal',galv,[x,y,h-.13],knee,.047);
  pipe(B,'metal',galv,knee,end,.043);
  const rot=Math.atan2(dy,dx);
  box(B,'metal','#686d68',end[0],end[1],end[2]-.035,.59,.245,.10,rot);
  box(B,'paint','#d5d7c9',end[0]+dx*.04,end[1]+dy*.04,end[2]-.055,.43,.18,.023,rot);
}
export function* buildPoles(ctx,B){
  const {ROAD,COMPOUND}=ctx.site;
  const [a,b]=COMPOUND.driveway;
  for(const t of [.20,.51,.83]){
    const [x,y]=mix(a,b,t);lamp(B,x,y+.83,5.4,0,1); // assumed driveway verge spacing
  }
  let previous=null,base=0,next=16;
  const r=ROAD.centerline;
  for(let i=1;i<r.length;i++){
    const a=r[i-1],b=r[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/len,ty=(b[1]-a[1])/len;
    const nx=ty,ny=-tx;
    while(next<base+len){
      yield;
      const p=mix(a,b,(next-base)/len),x=p[0]+nx*(ROAD.width/2+1.15),y=p[1]+ny*(ROAD.width/2+1.15);
      lamp(B,x,y,7.25,-nx,-ny); // assumed roadside lighting on west verge
      const ox=x+nx*1.03,oy=y+ny*1.03,h=8.7;
      pipe(B,'render','#b5b0a3',[ox,oy,0],[ox,oy,h],.135,8,.084);
      const cross=s=>[ox+nx*s,oy+ny*s,h-.21];
      bar(B,'metal','#60625d',cross(-.82),cross(.82),.080,.09);
      const attach=[];
      for(const s of [-.68,0,.68]){
        const pt=cross(s);pt[2]+=s===0?.24:.05;
        B.add('paint',placeAt(revolve(insulator,ctx.quality==='low'?6:10),...pt),'#827d68');
        attach.push(V(pt[0],pt[1],pt[2]+.17));
      }
      if(previous)for(let k=0;k<3;k++)
        B.add('metal',wireTube(catenary(previous[k],attach[k],.64+k*.036,ctx.quality==='low'?5:10),.011,4),'#5d5c56');
      previous=attach;next+=35; // assumed utility pole spacing
    }
    base+=len;
  }
}
