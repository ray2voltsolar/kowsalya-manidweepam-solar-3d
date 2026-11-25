// Pure plan geometry; metres in local east/north coordinates.
export const STEP = 0.25;
const EDGE_CLEAR = 0.43; // assumed centreline setback from traced parapets
const BLOCK_CLEAR = 0.152; // assumed allowance for tray width and clips

// Local X follows the wall; local depth is outward. These axes preserve winding.
export function stationPoint(s,u,v) {
  const [nx,ny]=s.normal;
  return [s.x+ny*u+nx*v,s.y-nx*u+ny*v];
}
export function stationLocal(s,x,y) {
  const [nx,ny]=s.normal,dx=x-s.x,dy=y-s.y;
  return [ny*dx-nx*dy,nx*dx+ny*dy];
}
function onSlab(site,x,y){
  return site.ROOF.polygons.some(p=>site.pointInRing(x,y,p.outer)&&!p.holes.some(h=>site.pointInRing(x,y,h)));
}
// Cardinal frames yield axis-aligned footprints. Reject ring edges within the
// rectangle too, so a narrow indentation cannot slip between corner samples.
function clearFootprint(site,s,left,right,near,far){
  const a=stationPoint(s,left,near),b=stationPoint(s,right,far);
  const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),y0=Math.min(a[1],b[1]),y1=Math.max(a[1],b[1]);
  if(!onSlab(site,(x0+x1)/2,(y0+y1)/2))return false;
  const overlaps=(ax,ay,bx,by,pad=0)=>Math.max(ax,bx)+pad>=x0&&Math.min(ax,bx)-pad<=x1
    &&Math.max(ay,by)+pad>=y0&&Math.min(ay,by)-pad<=y1;
  const cap=site.BUILDING.parapet.thickness+.035; // assumed coping return
  for(const p of site.ROOF.polygons)for(const ring of [p.outer,...p.holes])for(let i=0;i<ring.length;i++){
    if(overlaps(...ring[i],...ring[(i+1)%ring.length],cap))return false;
  }
  return !site.OBSTACLES.some(o=>o.id!==s.obstacle&&overlaps(o.x0,o.y0,o.x1,o.y1))
    &&!site.TABLES.some(t=>overlaps(t.x0,t.ySouth,t.x1,t.yNorth));
}
export function stationRack(site,s){
  // Assumed envelopes: 1.05 m castings, 300 mm ventilation gaps, 824 mm ACDB lid.
  const span=1.05+(s.inverters.length-1)*1.35;
  const short=span+.30+.824+.30+.32>s.width;
  const margin=short ? .062 : .16, cabinetGap=short ? .10 : .30;
  const fireSpace=short?0:.30;
  const width=fireSpace+span+cabinetGap+.824+2*margin;
  const nose=s.wall==='N'?1:1.4;
  // Assumed central stair access on long equipment walls. Keep the threshold
  // free, retain the inverter ventilation gaps, and carry the channels above it.
  if(s.width>=2*span+1.17){
    const west=-s.width/2+.035,first=west+.565;
    const xs=s.inverters.map((_,i)=>first+1.35*i),doorLeft=xs.at(-1)+.59;
    const cabinet=1.51,east=cabinet+.81;
    if(doorLeft<-.43 && east<=s.width/2 && clearFootprint(site,s,west,east,.012,1.76))
      return {xs,cabinet,west,east,nose,short:false,fire:cabinet+.62,
        door:[doorLeft,.84],matLeft:xs[0]-.55,matRight:xs.at(-1)+.55};
  }
  // Prefer a centred wall installation. On a short wall, keep the complete
  // inverter row on masonry and test both ends for the independent ACDB frame.
  for(let step=0;step<=Math.ceil(s.width/.04);step++)for(const offset of step?[step*.04,-step*.04]:[0]){
    for(const sign of [1,-1]){
      const west=offset-width/2,east=offset+width/2;
      const at=u=>offset+sign*(u-width/2);
      const xs=s.inverters.map((_,i)=>at(margin+fireSpace+.525+1.35*i));
      const cabinet=at(width-margin-.412);
      if(xs.some(x=>Math.abs(x)+.525>s.width/2-.015)) continue;
      if(!short && Math.max(Math.abs(west),Math.abs(east))>s.width/2)continue;
      if(!clearFootprint(site,s,west,east,.012,1.76))continue;
      return {xs,cabinet,west,east,nose,short,
        fire:short?xs[0]-sign*.34:at(margin+.13),
        matLeft:Math.min(...xs)-.55,matRight:Math.max(...xs)+.55};
    }
  }
  throw Error('No supported equipment footprint for '+s.id);
}

function* raster(site,stations) {
  const rings = site.ROOF.polygons.flatMap(p => [p.outer, ...p.holes]);
  const points = rings.flat();
  const ox = Math.floor(Math.min(...points.map(p => p[0]))) - 1;
  // Offset the 250 mm grid so the tight north-edge aisles retain full tray width.
  const oy = Math.floor(Math.min(...points.map(p => p[1]))) - 1.075;
  const w = Math.ceil((Math.max(...points.map(p => p[0])) - ox + 1) / STEP);
  const h = Math.ceil((Math.max(...points.map(p => p[1])) - oy + 1) / STEP);
  const n = w*h, floor = new Uint8Array(n), clear = new Uint8Array(n), solid = new Uint8Array(n);
  const point = i => [ox + i%w*STEP, oy + Math.floor(i/w)*STEP];
  const index = (x,y) => Math.round((x-ox)/STEP) + w*Math.round((y-oy)/STEP);
  const rect = (x0,y0,x1,y1,visit) => {
    for(let j=Math.max(0,Math.ceil((y0-oy)/STEP-1e-8));j<=Math.min(h-1,Math.floor((y1-oy)/STEP+1e-8));j++)
      for(let i=Math.max(0,Math.ceil((x0-ox)/STEP));i<=Math.min(w-1,Math.floor((x1-ox)/STEP));i++)
        visit(j*w+i,ox+i*STEP,oy+j*STEP);
  };
  // Even/odd scan conversion handles nested courtyards and both independent slabs.
  for(let j=0;j<h;j++){
    if (!(j%16)) yield;
    const y=oy+j*STEP, cuts=[];
    for(const ring of rings) for(let i=0;i<ring.length;i++){
      const a=ring[i], b=ring[(i+1)%ring.length];
      if((a[1]>y)!==(b[1]>y)) cuts.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));
    }
    cuts.sort((a,b)=>a-b);
    for(let k=0;k<cuts.length;k+=2) rect(cuts[k],y,cuts[k+1]-1e-8,y,i=>{ floor[i]=clear[i]=1; });
  }
  for(const ring of rings) for(let j=0;j<ring.length;j++){
    const [x,y]=ring[j], [u,v]=ring[(j+1)%ring.length], dx=u-x,dy=v-y, e=EDGE_CLEAR;
    rect(Math.min(x,u)-e,Math.min(y,v)-e,Math.max(x,u)+e,Math.max(y,v)+e,(i,a,b)=>{
      const t=Math.max(0,Math.min(1,((a-x)*dx+(b-y)*dy)/(dx*dx+dy*dy || 1)));
      if(Math.hypot(x+dx*t-a,y+dy*t-b)<e) clear[i]=0;
    });
  }
  for(const o of [...site.OBSTACLES,...site.TABLES.map(t=>({...t,y0:t.ySouth,y1:t.yNorth}))]){
    const e=BLOCK_CLEAR;
    rect(o.x0-e,o.y0-e,o.x1+e,o.y1+e,i=>{clear[i]=0;solid[i]=1;});
  }
  const access=clear.slice();
  for(const s of stations){
    const a=stationPoint(s,s.rack.west-.18,0),b=stationPoint(s,s.rack.east+.18,s.frontClearM+.15);
    rect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1]),i=>{clear[i]=0;solid[i]=1;});
  }
  const dirs=[1,-1,w,-w], component=new Int32Array(n), queue=new Int32Array(n);
  let count=0;
  for(let i=0;i<n;i++) if(clear[i]&&!component[i]){
    count++; let tail=1;queue[0]=i;component[i]=count;
    for(let q=0;q<tail;q++){
      if (!(q%2048)) yield;
      for(const d of dirs){
        const j=queue[q]+d;
        if(clear[j]&&!component[j]){component[j]=count;queue[tail++]=j;}
      }
    }
  }
  // Sort candidate bracket spans before linking islands. A bridge may cross air,
  // never a masked piece of plant or glass. Keep the actual bearing span <= 3 m.
  const candidates=[];
  for(let i=0;i<n;i++){
    if (!(i%4096)) yield;
    if(!clear[i]) continue;
    for(const d of [1,w]){
      if(clear[i+d]) continue;
      let air=0;
      for(let k=1;k<=(3+2*EDGE_CLEAR+STEP)/STEP;k++){
        const j=i+k*d;
        if(j>=n || solid[j] || (d===1 && j%w<i%w)) break;
        if(!floor[j]) air++;
        if(clear[j]){
          if(air && (air+1)*STEP<=3 && component[i]!==component[j]) candidates.push([i,j,k]);
          break;
        }
      }
    }
  }
  candidates.sort((a,b)=>a[2]-b[2]);
  const parent=Array.from({length:count+1},(_,i)=>i);
  const root=i=>{while(i!==parent[i]) i=parent[i];return i;};
  const jumps=new Map();
  for(const [i,j] of candidates){
    const a=root(component[i]),b=root(component[j]);
    if(a===b)continue;
    parent[a]=b;
    for(const [v,u] of [[i,j],[j,i]]){if(!jumps.has(v)) jumps.set(v,[]);jumps.get(v).push(u);}
  }
  return {w,n,point,index,clear,access,dirs,jumps,queue,dist:new Int32Array(n),visited:new Uint16Array(n),searchId:0,region:i=>root(component[i])};
}

function graph() {return new Map();}
function link(net,a,b) {
  if(!net.has(a))net.set(a,new Set());
  if(!net.has(b))net.set(b,new Set());
  net.get(a).add(b);net.get(b).add(a);
}
function length(g,a,b) {
  const [x,y]=g.point(a),[u,v]=g.point(b);return Math.abs(x-u)+Math.abs(y-v);
}

// Reverse breadth-first field from the existing trunk. Minimise new tray;
// on equivalent paths hold the current heading to avoid gratuitous elbows.
function* attach(g,tree,starts,net) {
  if(starts.some(i=>tree.has(i))) return;
  const {dist,queue,visited}=g, mark=++g.searchId;
  let tail=0, exit=-1;
  const targets=new Set(starts);
  for(const i of tree){visited[i]=mark;dist[i]=0;queue[tail++]=i;}
  for(let q=0;q<tail && exit<0;q++){
    if (!(q%2048)) yield;
    const i=queue[q], jumps=g.jumps.get(i);
    for(let k=0;k<4+(jumps?.length||0);k++){
      const j=k<4 ? i+g.dirs[k] : jumps[k-4];
      if(!g.clear[j]||visited[j]===mark)continue;
      visited[j]=mark;
      dist[j]=dist[i]+1;queue[tail++]=j;
      if(targets.has(j)){exit=j;break;}
    }
  }
  if(exit<0)throw Error('Unreachable array or station at '+g.point(starts[0]));
  let i=exit,prev=0;
  while(dist[i]>0){
    const options=[...g.dirs.map(d=>i+d),...(g.jumps.get(i)||[])].filter(j=>visited[j]===mark&&dist[j]===dist[i]-1&&g.clear[j]);
    const j=options.find(j=>j-i===prev)??options[0];
    tree.add(i);link(net,i,j);prev=j-i;i=j;
  }
}
function* segments(g,net,branches) {
  const runs=[];
  let visited=0;
  for(const [i,edges] of net){
    if (!(visited++%256)) yield;
    for(const j of edges){
      if(j<=i)continue;
      const d=j-i, bridge=d!==1&&d!==g.w;
      const branch=branches?.get(i)?.has(j)??false;
      const same=(a,b)=>net.get(a)?.has(b)&&(branches?.get(a)?.has(b)??false)===branch;
      if(!bridge && same(i-d,i))continue;
      let k=j;while(!bridge && same(k,k+d))k+=d;
      runs.push({a:g.point(i),b:g.point(k),bridge,branch});
    }
  }
  return runs;
}
function* networkDistances(g,net,start,bridgeRise) {
  // Physical edge weights include the full span of a bridge.
  const dist=new Map([[start,0]]),q=[start];
  for(let k=0;k<q.length;k++){
    if (!(k%256)) yield;
    const i=q[k];
    for(const j of net.get(i)||[]){
      const span=length(g,i,j);
      const d=dist.get(i)+span+(span>STEP+1e-6?2*bridgeRise:0);
      if(d<(dist.get(j)??Infinity)){dist.set(j,d);q.push(j);}
    }
  }
  return dist;
}
function northBranch(g,t,dock){
  let best=[];
  for(let row=0;row<Math.ceil(1/STEP);row++){
    const y=(Math.ceil((t.yNorth+BLOCK_CLEAR)/STEP)+row)*STEP;
    let run=[];
    for(let x=Math.ceil(t.x0/STEP)*STEP;x<=t.x1;x+=STEP){
      const i=g.index(x,y);
      if(!g.clear[i] || g.region(i)!==g.region(dock))run=[];
      else {run.push(i);if(run.length>best.length)best=run.slice();}
    }
    if(best.length*STEP>=t.x1-t.x0-STEP)break;
  }
  if(!best.length)throw Error('No north-side branch for '+t.id);
  return best;
}
export function rackChannel(rack,from,to,ac){
  const depth=ac ? .342 : .206,level=ac ? .330 : .182;
  const at=(x,z)=>[x,depth,z];
  const p=[at(from,level)];
  const d=rack.door;
  if(d && Math.min(from,to)<=d[0] && Math.max(from,to)>=d[1]){
    const [left,right]=from<to?d:[d[1],d[0]],lintel=ac?2.30:2.22; // assumed overdoor cable bridge
    p.push(at(left,level),at(left,lintel),at(right,lintel),at(right,level));
  }
  p.push(at(to,level));return p;
}
export function channelLength(points){
  return points.slice(1).reduce((m,p,i)=>m+Math.hypot(...p.map((v,j)=>v-points[i][j])),0);
}
// The checker consumes the same steps synchronously. The renderer schedules
// them between input events without duplicating the routing algorithm.
export function planRoutes(site,modules) {
  return complete(routeSteps(site,modules,true));
}
function complete(steps) {
  let step;
  do { step=steps.next(); } while (!step.done);
  return step.value;
}
export function* routeSteps(site,modules=site.computeLayout(),includeCells=false) {
  const stations=site.INVERTER_STATIONS.map(s=>({...s,rack:stationRack(site,s)}));
  const g=yield* raster(site,stations),dc=graph(),ac=graph(),branches=graph();
  // The graph stops outside the service area. Add each terminal-only spur
  // once all through routes have been traced.
  for(const s of stations){
    let best=Infinity;
    for(let u=s.rack.west+.16;u<=s.rack.east-.16;u+=STEP/2){
      const dock=g.index(...stationPoint(s,u,.75));
      const start=g.index(...stationPoint(s,u,s.frontClearM+.40));
      const stride=s.normal[0]+g.w*s.normal[1];
      if(!g.clear[start]||!g.access[dock] || s!==stations[0]&&g.region(start)!==g.region(stations[0].start))continue;
      const spur=[];
      for(let i=dock;i!==start+stride;i+=stride)spur.push(i);
      if(spur.some(i=>!g.access[i]))continue;
      const score=Math.abs(u-s.rack.cabinet);
      if(score<best){best=score;Object.assign(s,{dock,start,spur,entry:g.point(dock)});}
    }
    if(!s.spur)throw Error('Missing station access '+s.id);
    s.tree=new Set([s.start]);
  }
  const stationOf=id=>stations.find(s=>s.inverters.includes(id));
  const riser=site.AC_RISER;
  // Land on the duct wall nearest the specified riser centre, biased toward LT.
  const ring=site.ROOF.polygons.flatMap(p=>p.holes).find(h=>site.pointInRing(riser.x,riser.y,h));
  if(!ring)throw Error('AC riser does not lie in a duct');
  // The nearest geometric point can be behind a headroom. Choose the nearest
  // coping with a clear, straight terrace approach, on this same courtyard.
  const origin=stations.reduce((a,b)=>Math.hypot(a.x-riser.x,a.y-riser.y)<Math.hypot(b.x-riser.x,b.y-riser.y)?a:b);
  const steps=new Int32Array(g.n).fill(-1),queue=[origin.start];
  steps[origin.start]=0;
  for(let i=0;i<queue.length;i++){
    if (!(i%2048)) yield;
    const k=queue[i], jumps=g.jumps.get(k);
    for(let d=0;d<4+(jumps?.length||0);d++){
      const j=d<4 ? k+g.dirs[d] : jumps[d-4];
      if (!g.clear[j] || steps[j]>=0) continue;
      steps[j]=steps[k]+1;queue.push(j);
    }
  }
  let face,normal,riserDock,distance=Infinity;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    if(len<.6 || dx&&dy)continue;
    const inward=[dy/len,-dx/len]; // hole rings wind clockwise
    for(let j=.95;j<=len-.95;j+=STEP){
      const dock=g.index(a[0]+dx*j/len-inward[0]*.46,a[1]+dy*j/len-inward[1]*.46);
      if(steps[dock]<0)continue;
      const [x,y]=g.point(dock),f=[dx?x:a[0],dy?y:a[1]];
      // Prefer the near bank over a visually adjacent point reached only
      // by circling the entire building.
      const d=Math.hypot(f[0]-riser.x,f[1]-riser.y)+steps[dock]*STEP*.10;
      if(d>=distance)continue;
      if(site.OBSTACLES.some(o=>Math.max(x,f[0])+.13>o.x0 && Math.min(x,f[0])-.13<o.x1
          && Math.max(y,f[1])+.13>o.y0 && Math.min(y,f[1])-.13<o.y1))continue;
      distance=d;face=f;normal=inward;riserDock=dock;
    }
  }
  if(!face)throw Error('No accessible courtyard coping');
  const landing=g.point(riserDock),acTree=new Set([riserDock]);
  for(const s of stations)yield* attach(g,acTree,[s.start],ac);
  const byArray=new Map(),byTable=new Map();
  for(const m of modules){
    if(!byArray.has(m.array))byArray.set(m.array,new Map());
    const counts=byArray.get(m.array);counts.set(m.inverter,(counts.get(m.inverter)||0)+1);
  }
  const arrays=site.LAYOUT.arrays.map(a=>{
    const counts=byArray.get(a.id);
    const inv=[...counts].sort((a,b)=>b[1]-a[1])[0][0],s=stationOf(inv);
    return {id:a.id,station:s.id,inverter:inv,distance:Math.hypot(a.x0-s.x,a.y0-s.y)};
  }).sort((a,b)=>a.distance-b.distance);
  for(const a of arrays){
    const s=stations.find(s=>s.id===a.station);
    for(const t of site.TABLES.filter(t=>t.array===a.id)){
      yield;
      const branch=northBranch(g,t,s.start);
      yield* attach(g,s.tree,branch,dc);
      for(let i=0;i<branch.length;i++){
        s.tree.add(branch[i]);if(i){link(dc,branch[i-1],branch[i]);link(branches,branch[i-1],branch[i]);}
      }
      byTable.set(t.id,branch);
    }
  }
  // An array can contain strings from both stations. Interconnect DC trunks
  // when needed so string home runs reach their actual assigned inverter.
  if(modules.some(m=>stationOf(m.inverter).id!==arrays.find(a=>a.id===m.array).station)){
    for(const s of stations.slice(1))yield* attach(g,stations[0].tree,[...s.tree],dc);
  }
  for(const {spur} of stations)for(let i=1;i<spur.length;i++){
    link(dc,spur[i-1],spur[i]);link(ac,spur[i-1],spur[i]);
  }
  const fields=new Map();
  for(const s of stations) fields.set(s.id,yield* networkDistances(g,dc,s.dock,site.BUILDING.parapet.height+.15-.182));
  const routes=site.STRINGS.map(string=>{
    const list=modules.filter(m=>m.string===string.id),s=stationOf(string.inverter);
    // Positive and negative home runs leave opposite ends of the string.
    let lengthM=0;
    for(const m of [list[0],list.at(-1)]){
      const branch=byTable.get(m.table);
      const i=branch.reduce((a,b)=>Math.abs(g.point(a)[0]-m.center[0])<=Math.abs(g.point(b)[0]-m.center[0])?a:b);
      const [x,y]=g.point(i),rack=s.rack,input=rack.xs[s.inverters.indexOf(string.inverter)]+.098;
      const [u,v]=stationLocal(s,...s.entry);
      const rackTail=Math.abs(v-.206)+channelLength(rackChannel(rack,u,input,false))+.85;
      lengthM+=fields.get(s.id).get(i)+Math.abs(x-m.center[0])+Math.abs(y-m.center[1])+m.center[2]-site.ROOF.z+rackTail; // assumed final 0.85 m from rack channel to gland
    }
    if(!Number.isFinite(lengthM))throw Error('Open string home run '+string.id);
    return {string:string.id,inverter:string.inverter,lengthM};
  });
  const acDistances=yield* networkDistances(g,ac,riserDock,site.BUILDING.parapet.height+.30-.330);
  // Bearings sit on the two masonry banks. The raster landing is farther
  // inland to retain parapet clearance on the ordinary parts of the route.
  function* annotate(run){
    const a=run.a,b=run.b,l=Math.hypot(b[0]-a[0],b[1]-a[1]),part=Math.ceil(l/.01);
    const point=t=>a.map((v,i)=>v+(b[i]-v)*t);
    let first=part,last=0;
    for(let i=0;i<=part;i++){
      if (!(i%48)) yield;
      const [x,y]=point(i/part);
      if(!site.ROOF.polygons.some(p=>site.pointInRing(x,y,p.outer)&&!p.holes.some(h=>site.pointInRing(x,y,h)))){
        first=Math.min(first,i);last=i;
      }
    }
    return {...run,bearings:[point((first-1)/part),point((last+1)/part)]};
  }
  const tableBonds=site.TABLES.map(t=>{
    const [x,y]=g.point(byTable.get(t.id)[0]);return {a:[x,y],b:[x,t.yNorth],z:t.zHigh,table:t.id,array:t.array};
  });
  const turns=[];
  for(const [i,edges] of dc){
    let wx=0,wy=0;
    for(const j of edges){
      const width=branches.get(i)?.has(j) ? .15 : .30;
      if(Math.abs(i-j)===1)wx=Math.max(wx,width);
      if(Math.abs(i-j)===g.w)wy=Math.max(wy,width);
    }
    if(wx&&wy)turns.push({point:g.point(i),wx,wy});
  }
  function* supportedRuns(net,branchNet) {
    const runs=yield* segments(g,net,branchNet);
    for(let i=0;i<runs.length;i++) if(runs[i].bridge) runs[i]=yield* annotate(runs[i]);
    return runs;
  }
  yield;
  const dcRuns=yield* supportedRuns(dc,branches);
  yield;
  const acRuns=yield* supportedRuns(ac);
  return {dc:dcRuns,ac:acRuns,turns,arrays,routes,tableBonds,landing,face,normal,
    stations:stations.map(s=>({id:s.id,entry:s.entry,approach:g.point(s.start),acLength:acDistances.get(s.dock)||0})),
    ...(includeCells ? {dcCells:Array.from(dc.keys(),g.point),acCells:Array.from(ac.keys(),g.point)} : {})};
}


export function edgeMasts(site) { return complete(mastSteps(site)); }
export function* mastSteps(site) {
  const free=(x,y)=>!site.OBSTACLES.some(o=>x>o.x0-.5&&x<o.x1+.5&&y>o.y0-.5&&y<o.y1+.5)
    && !site.TABLES.some(t=>Math.hypot(x-Math.max(t.x0,Math.min(t.x1,x)),y-t.ySouth)<2)
    && !site.TABLES.some(t=>x>t.x0-1.2&&x<t.x1+1.2&&y>t.ySouth-10&&y<t.yNorth+.5);
  const candidates=[];
  for(const p of site.ROOF.polygons)for(let i=0;i<p.outer.length;i++){
    if (!(i%16)) yield;
    const a=p.outer[i],b=p.outer[(i+1)%p.outer.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(l<2)continue;
    const n=[-(b[1]-a[1])/l,(b[0]-a[0])/l]; // inward on CCW outer boundary
    for(let j=1;j<l-.7;j+=1){
      const wall=a.map((v,i)=>v+(b[i]-v)*j/l),foot=wall.map((v,i)=>v+n[i]*.69);
      if(!site.pointInRing(...foot,p.outer)||p.holes.some(h=>site.pointInRing(...foot,h))||!free(...foot))continue;
      candidates.push({wall,foot,n});
    }
  }
  // Assumed protection zones; snap each to a traced, accessible perimeter edge.
  const selected=[];
  for(const aim of [[-67,11],[-19,31],[35,18],[14,-31],[-16,-94],[-68,-75]]){
    yield;
    let first, nearest=Infinity;
    for(const c of candidates){
      const distance=Math.hypot(c.foot[0]-aim[0],c.foot[1]-aim[1]);
      if(distance>=nearest || selected.some(m=>Math.hypot(m.foot[0]-c.foot[0],m.foot[1]-c.foot[1])<=12)) continue;
      first=c; nearest=distance;
    }
    if(first)selected.push(first);
  }
  return selected;
}
