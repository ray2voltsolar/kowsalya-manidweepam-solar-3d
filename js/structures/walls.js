import { V, tubePath } from './kit.js';
import { edges, mix, box, edgeBar, pipe, bar } from './geometry.js';

const cement='#d7cdbb',cap='#e3dacb',iron='#676861',basalt='#8a8071';
// assumed: plaster pier rhythm, weathering plinth, top grille and entrance finishes.
function* wallRun(B,a,b,h,low) {
  const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(len<.15)return;
  const n=Math.max(1,Math.round(len/3.1)), rot=Math.atan2(b[1]-a[1],b[0]-a[0]);
  const masonry=h-.38;
  edgeBar(B,'render',cement,a,b,0,.215,masonry);
  edgeBar(B,'stone','#a99d88',a,b,.018,.25,.35);
  edgeBar(B,'paving',cap,a,b,masonry-.035,.31,.095);
  for(const level of [masonry+.10,h-.07])edgeBar(B,'metal',iron,a,b,level,.041,.043);
  for(let j=0;j<n;j++){
    if(j%4===0)yield;
    const p=mix(a,b,j/n);
    box(B,'render','#c1b6a3',...p,0,.36,.35,h+.02,rot);
    box(B,'paving',cap,...p,h+.02,.43,.42,.075,rot);
    for(let k=1;k<=(low?2:9);k++){
      const c=mix(a,b,(j+k/(low?3:10))/n);
      box(B,'metal',iron,...c,masonry+.09,.027,.023,h-masonry-.13,rot);
    }
  }
}

function gate(B,site){
  const {x,y,width}=site.COMPOUND.gate, north=y+width/2,south=y-width/2;
  for(const side of [-1,1]){
    const py=y+side*(width/2+.28);
    box(B,'stone','#ac9f87',x,py,.02,.76,.56,2.54);
    box(B,'render','#e4d7c3',x,py,2.56,.85,.68,.13);
    box(B,'metal','#5f5c54',x-.401,py,1.73,.05,.20,.35);
    box(B,'paint','#e0d6b8',x-.43,py,1.79,.015,.13,.21);
  }
  // A telescoped leaf parks behind a grille north of the opening.
  const gx=x+.48,cy=north+width/2-.45;
  box(B,'metal',iron,gx,y+width/2,.052,.105,width*2+.2,.04);
  for(const level of [.18,1.13,1.91])box(B,'metal','#565751',gx,cy,level,.115,width,.095);
  for(let k=0;k<=30;k++)box(B,'metal',k%5?'#666961':'#545850',gx,cy-width/2+k*width/30,.23,.09,k%5?.045:.095,1.72);
  for(const s of [-1,1])pipe(B,'metal','#474a47',[gx-.06,cy+s*2.61,.18],[gx+.06,cy+s*2.61,.18],.109,12);
  // Stone entrance marker with a genuinely inset blank panel and overhanging coping.
  const fy=north+3.55;
  box(B,'stone',basalt,x-.02,fy,.015,.52,6.35,2.48);
  box(B,'paving','#b7aa94',x-.025,fy,2.495,.64,6.52,.13);
  box(B,'metal','#625d52',x-.30,fy, .62,.052,4.87,1.41);
  box(B,'stone','#b8ab96',x-.34,fy,.67,.036,4.74,1.31);
  for(const level of [.53,2.04])box(B,'stone','#9e917b',x-.37,fy,level,.16,5.13,.12);
  for(const sy of [-1,1])box(B,'stone','#9e917b',x-.37,fy+sy*2.51,.62,.16,.11,1.43);

  const cx=x+3.07,py=north+1.02;
  box(B,'paving','#a9a08e',cx,py,.04,2.96,3.31,.18);
  box(B,'render','#cfc4ae',cx,py,.22,2.53,2.80,.88);
  box(B,'render','#d6cfbd',cx+1.19,py,1.1,.15,2.80,1.61);
  box(B,'render','#cdc4b2',cx,py+1.33,1.1,2.53,.15,1.61);
  box(B,'render','#d6cfbd',cx,py,2.29,2.53,2.80,.43);
  for(const dx of [-1.19,1.19])for(const dy of [-1.32,1.32])box(B,'render','#cdc4af',cx+dx,py+dy,1.09,.19,.18,1.21);
  box(B,'stone','#9c927e',cx,py,.22,2.57,2.84,.70);
  box(B,'wood','#907956',cx-.70,py,1.10,.67,2.36,.075);
  box(B,'paint','#444c49',cx-.55,py+.20,1.185,.18,.40,.25);
  box(B,'wood','#9c886d',cx+.18,py+.58,.64,.47,.42,.095);
  box(B,'wood','#9c886d',cx+.40,py+.58,.68,.055,.42,.51);
  for(const side of ['west','south']){
    const panel=(k,c,d,along,z,w,h,t)=>{
      if(side==='west')box(B,k,c,cx-1.27-d,py+along,z,t,w,h);
      else box(B,k,c,cx+along,py-1.41-d,z,w,t,h);
    };
    panel('window','#72918b',.026,0,1.13,side==='west'?2.60:2.35,1.16,.018);
    for(const z of [1.12,2.245])panel('metal','#545955',.054,0,z,side==='west'?2.59:2.36,.055,.06);
    for(const o of [-.55,.22])panel('metal','#535b56',.08,o,1.18,.038,1.05,.035);
    panel('paving',cap,.06,0,1.055,2.27,.075,.21);
  }
  box(B,'wood','#957e60',cx,py,2.68,3.18,3.46,.15);
  box(B,'paving','#ded5c4',cx,py,2.83,3.23,3.55,.13);
  box(B,'paint','#626a61',cx+.37,py+1.425,.24,1.01,.055,2.07);
  box(B,'paint','#9da597',cx+.37,py+1.458,.28,.90,.035,1.98);
  // Barrier island just inside the opening, with the arm raised above the entry lane.
  const bx=x+3.15,by=south+.68;
  box(B,'paving','#b5ab96',bx,by,.025,1.72,1.06,.17);
  box(B,'paint','#b3834c',bx,by,.195,.42,.38,.90);
  box(B,'paint','#565950',bx,by,1.095,.45,.41,.12);
  const end=[bx,by+3.7,3.04],start=[bx,by,1.1];
  bar(B,'paint','#e5dfcf',start,end,.11,.11);
  for(let k=0;k<5;k++)bar(B,'paint','#b64f36',mix(start,end,(k+.3)/5),mix(start,end,(k+.68)/5),.117,.117);
  pipe(B,'metal',iron,[bx-.26,by,1.10],[bx+.26,by,1.10],.125,14);
  for(const s of [-1,1]){
    const px=bx+s*.65;
    const guard=[[px,by-.27,.17],[px,by-.27,.62],[px,by+.23,.62],[px,by+.23,.17]];
    B.add('metal',tubePath(guard.map(p=>V(...p)),.043,8,.09,.12),'#72766d');
  }
}

export function* buildWalls(ctx,B){
  const {polygon,wallHeight,gate:g}=ctx.site.COMPOUND;
  for(const [a,b] of edges(polygon)){
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),t=((g.x-a[0])*dx+(g.y-a[1])*dy)/(len*len);
    const near=mix(a,b,t);
    if(t>0&&t<1&&Math.hypot(near[0]-g.x,near[1]-g.y)<.01){
      const cut=(g.width/2+.28)/len;
      yield* wallRun(B,a,mix(a,b,t-cut),wallHeight,ctx.quality==='low');
      yield* wallRun(B,mix(a,b,t+cut),b,wallHeight,ctx.quality==='low');
    }else yield* wallRun(B,a,b,wallHeight,ctx.quality==='low');
  }
  gate(B,ctx.site);
}
