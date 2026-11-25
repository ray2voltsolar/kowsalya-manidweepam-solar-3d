// BOS round-two project scratchpad and acceptance check.
// Goal: a buildable-looking terrace station, readable trays and traceable home runs.
// Basis: keep the supplied roof, furniture, electrical schedule and building datum.
// Assumed: coping bearings, canopy and cabinet fixings, and a 5 mm rubber mat.
// Decisions: hang the equipment in wall-local coordinates. Support short-wall
// ACDBs on the slab. Split long-wall equipment around the stair access. Reserve
// the service area in the router and allow only the cabinet-side terminal spur.
// At the riser, the geometric projection sits behind a headroom. Use accessible
// coping on the near bank and finish at the specified LT coordinates.
// Verified in the GPU preview at 5 m, overhead, at the courtyard landing
// and LT panel, and at all six mast bonds. Images are in _work/shots/bos2.
// Measured maxima across the four variants: 58,956 triangles / 12 main-pass
// calls on high and 19,948 triangles / 10 calls on low.
// Run from the project root with node webapp/js/solar/bos-route-check.js.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planRoutes,stationRack,stationPoint,stationLocal,edgeMasts,STEP} from './bos-route.js';

if(!process.argv[2]){
  const site=await import('../site-data.js');
  // The live layouts currently use east and north. Rotate a narrow test
  // terrace to exercise the other two faces and a left-hand cabinet extension.
  for(const [wall,normal] of Object.entries({N:[0,1],E:[1,0],S:[0,-1],W:[-1,0]})){
    for(const sign of [1,-1]){
      const station={...site.INVERTER_STATIONS.at(-1),x:0,y:0,wall,normal};
      const outer=[[-1.45,-3],[2.45,-3],[2.45,4],[-1.45,4]].map(([u,v])=>stationPoint(station,u*sign,v));
      const frameSite={...site,ROOF:{polygons:[{outer,holes:[]}]},TABLES:[],OBSTACLES:[]};
      const rack=stationRack(frameSite,station);
      assert(rack.short&&sign*rack.cabinet>station.width/2);
      assert.equal(rack.nose,wall==='N'?1:1.4);
      assert.deepEqual(stationLocal(station,...stationPoint(station,1,.75)),[1,.75]);
    }
  }
  for(const v of site.VARIANT_KEYS){
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),v],{stdio:'inherit'});
    assert.equal(child.status,0,v);
  }
}else{
  const variant=process.argv[2],[module,mount]=variant.split('|');
  globalThis.location={search:'?module='+module+'&mount='+mount};
  const site=await import('../site-data.js');
  assert.equal(site.VARIANT.key,variant);
  const plan=planRoutes(site);
  const slab=([x,y])=>site.ROOF.polygons.some(p=>site.pointInRing(x,y,p.outer)&&!p.holes.some(h=>site.pointInRing(x,y,h)));
  const clear=([x,y])=>!site.OBSTACLES.some(o=>x>=o.x0&&x<=o.x1&&y>=o.y0&&y<=o.y1)
    && !site.TABLES.some(t=>x>=t.x0&&x<=t.x1&&y>=t.ySouth&&y<=t.yNorth);
  for(const point of [...plan.dcCells,...plan.acCells])assert(slab(point)&&clear(point),'Invalid tray cell '+point);
  const id=p=>p.map(v=>Math.round(v/STEP)).join(',');
  function lengthsAndGraph(runs,ac=false){
    let metres=0;const graph=new Map();
    const edge=(p,q)=>{for(const [a,b] of [[id(p),id(q)],[id(q),id(p)]]){
      if(!graph.has(a))graph.set(a,new Set());graph.get(a).add(b);
    }};
    for(const {a,b,bridge,bearings,branch} of runs){
      assert(a[0]===b[0]||a[1]===b[1],'Nonrectilinear tray');
      const len=Math.hypot(a[0]-b[0],a[1]-b[1]);metres+=len;
      if(bridge){
        assert(bearings.every(slab),'Missing bridge bearing');
        assert(Math.hypot(bearings[0][0]-bearings[1][0],bearings[0][1]-bearings[1][1])<=3,'Bridge span');
      }
      const xy=t=>a.map((v,i)=>v+(b[i]-v)*t);
      for(let i=0;i<=Math.ceil(len/.05);i++){
        const p=xy(i/Math.ceil(len/.05));
        const radius=ac||branch ? .075 : .15;
        const nx=(b[1]-a[1])/len,ny=(a[0]-b[0])/len;
        for(const offset of [-radius,0,radius]){
          const q=[p[0]+nx*offset,p[1]+ny*offset];
          assert(clear(q)&&(bridge||slab(q)),'Interrupted tray footprint '+q);
        }
      }
      const n=bridge?1:Math.round(len/STEP);
      for(let i=0;i<n;i++)edge(xy(i/n),xy((i+1)/n));
    }
    return {metres,graph};
  }
  const dc=lengthsAndGraph(plan.dc),ac=lengthsAndGraph(plan.ac,true);
  function reachable(graph,entry){
    const todo=[id(entry)],seen=new Set(todo);
    for(let i=0;i<todo.length;i++)for(const j of graph.get(todo[i])||[])if(!seen.has(j)){seen.add(j);todo.push(j);}
    return seen;
  }
  const acSet=reachable(ac.graph,plan.landing);
  for(const st of plan.stations){
    const station=site.INVERTER_STATIONS.find(s=>s.id===st.id),rack=stationRack(site,station);
    const [dock,depth]=stationLocal(station,...st.entry);
    assert(depth>=.60&&depth<=.90,'Station dock depth');
    assert(dock+.15<=rack.matLeft||dock-.15>=rack.matRight,'Station entry overlaps mat');
    for(const point of [...plan.dcCells,...plan.acCells]){
      const [u,v]=stationLocal(station,...point);
      if(u>=rack.west&&u<=rack.east&&v>0&&v<station.frontClearM)
        assert(Math.abs(u-dock)<1e-6 && v>=depth-1e-6,'Through route in service space');
    }
    for(let u=rack.west;u<=rack.east+.04;u+=.04)for(const v of [.012,.14,.54,1,1.4,1.75]){
      const q=stationPoint(station,Math.min(u,rack.east),v);
      assert(slab(q)&&clear(q),'Unsupported station footprint '+q);
    }
    assert(acSet.has(id(st.entry)),'Open AC feeder '+st.id);
    const net=reachable(dc.graph,st.entry);
    for(const a of plan.arrays.filter(a=>a.station===st.id)){
      const modules=site.computeLayout().filter(m=>m.array===a.id),counts={};
      for(const m of modules)counts[m.inverter]=(counts[m.inverter]||0)+1;
      assert.equal(counts[a.inverter],Math.max(...Object.values(counts)));
      assert(site.INVERTER_STATIONS.find(s=>s.id===st.id).inverters.includes(a.inverter));
      const bonds=plan.tableBonds.filter(b=>b.array===a.id);
      assert.equal(bonds.length,site.TABLES.filter(t=>t.array===a.id).length);
      for(const b of bonds)assert(net.has(id(b.a)),'Open table branch '+b.table);
    }
  }
  assert.equal(plan.arrays.length,site.LAYOUT.arrays.length);
  assert.equal(plan.routes.length,site.STRINGS.length);
  for(const s of site.STRINGS)assert(plan.routes.some(r=>r.string===s.id&&r.inverter===s.inverter&&r.lengthM>0));
  const masts=edgeMasts(site);
  assert.equal(masts.length,6);
  const nearestSouth=Math.min(...masts.flatMap(({foot:[x,y]})=>site.TABLES.map(t=>
    Math.hypot(x-Math.max(t.x0,Math.min(x,t.x1)),y-t.ySouth))));
  assert(nearestSouth>=2,'Air terminal within 2 m of a south table edge');
  assert(slab(plan.landing));
  assert(!slab(plan.face.map((v,i)=>v+.27*plan.normal[i])),'Riser must descend inside the courtyard');
  console.log(variant,plan.arrays.length+' arrays,',plan.tableBonds.length+' tables,',plan.routes.length+' strings;',
    'horizontal DC tray '+dc.metres.toFixed(2)+' m, AC tray '+ac.metres.toFixed(2)+' m,',
    nearestSouth.toFixed(2)+' m minimum mast clearance, DC home runs '+plan.routes.reduce((a,r)=>a+r.lengthM,0).toFixed(1)+' m');
}

