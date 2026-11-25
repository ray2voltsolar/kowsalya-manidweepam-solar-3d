import * as THREE from 'three';
import { GB } from './geom.js';
import { makeConcreteTexture, makeGalvTexture } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const UNIT = V(1, 1, 1);
const IDENTITY = new THREE.Quaternion();

// A pedestal is a square, so checking only its centre can leave a corner over a duct.
// Include traced boundary vertices and edges to catch
// re-entrant corners and narrow slots entirely between two sampled pad corners.
function slabTest(site, half, cacheRows=true) {
  const { polygons } = site.ROOF;
  const obstacles = site.OBSTACLES;
  const vertices = polygons.flatMap(p => [p.outer, ...p.holes].flat());
  const xs = vertices.map(p => p[0]), ys = vertices.map(p => p[1]);
  for (const o of obstacles) { xs.push(o.x0, o.x1); ys.push(o.y0, o.y1); }
  const rings = polygons.map(p => [p.outer, ...p.holes]);
  const edges = rings.flat().flatMap(r => r.map(([x,y],i) => {
    const [u,v] = r[(i+1)%r.length];
    return {x0:Math.min(x,u), x1:Math.max(x,u), y0:Math.min(y,v), y1:Math.max(y,v)};
  }));
  const rows = new Map();
  function crossings(r,y) {
    const cuts = [];
    for (let i=0;i<r.length;i++) {
      const a=r[i], b=r[(i+1)%r.length];
      if ((a[1]>y)!==(b[1]>y)) cuts.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));
    }
    return cuts.sort((a,b)=>a-b);
  }
  function inside(cuts,x) {
    for (let i=0;i<cuts.length;i+=2) if (x>=cuts[i] && x<cuts[i+1]) return true;
    return false;
  }
  function clear(x,y) {
    const x0=x-half, x1=x+half, y0=y-half, y1=y+half;
    // Feet in the same row share all north/south tests. Retain the original
    // four corner, re-entrant vertex and edge tests for diagonal trace edges.
    let row=rows.get(y);
    if (!row) {
      row={obstacles:obstacles.filter(o=>o.y0<y1 && o.y1>y0),
        vertices:vertices.filter(p=>p[1]>=y0 && p[1]<=y1),
        edges:edges.filter(e=>e.y0<y1 && e.y1>y0),
        slabs:rings.map(r=>[y0,y1].map(h=>r.map(ring=>crossings(ring,h))))};
      if (cacheRows) rows.set(y,row);
    }
    if (row.obstacles.some(o=>o.x0<x1 && o.x1>x0) ||
        row.vertices.some(p=>p[0]>=x0 && p[0]<=x1) ||
        row.edges.some(e=>e.x0<x1 && e.x1>x0)) return false;
    return row.slabs.some(slab=>slab.every(lines=>[x0,x1].every(a=>
      inside(lines[0],a) && !lines.some((holes,i)=>i && inside(holes,a)))));
  }
  return { clear, xs, ys };
}

function candidates(aim, lo, hi, edges, half) {
  const inside = x => Math.max(lo, Math.min(hi, x));
  const list = [inside(aim), lo, hi];
  for (const edge of edges) for (const d of [-half, half]) {
    const x = edge + d;
    if (x > lo && x < hi) list.push(x);
  }
  return [...new Set(list)].sort((a, b) => Math.abs(a - aim) - Math.abs(b - aim));
}

function makeFootings(table, width, spacing, slab) {
  const { x0, x1, ySouth, yNorth } = table;
  const half = width / 2 + 0.005; // assumed 5 mm modelling tolerance inside the terrace
  const xInset = Math.min(spacing * 0.20, (x1 - x0) * 0.23); // assumed short purlin cantilever
  const yInset = Math.min(0.62, (yNorth - ySouth) * 0.25); // assumed bearing near first and last purlins
  const front = ySouth + yInset, rear = yNorth - yInset;
  const maxBay = spacing > 3 ? 4.5 : 3.0; // assumed nominal maximum before shifting a footing clear of a duct
  const bays = Math.max(1, Math.ceil((x1 - x0 - 2 * xInset) / maxBay));
  const pitch = (x1 - x0 - 2 * xInset) / bays;
  const frames = [];
  for (let i = 0; i <= bays; i++) {
    const aim = x0 + xInset + i * pitch;
    const lo = i ? aim - pitch / 2 + half : x0 + half;
    const hi = i < bays ? aim + pitch / 2 - half : x1 - half;
    const nominal=Math.max(lo,Math.min(hi,aim));
    if (slab.clear(nominal,front) && slab.clear(nominal,rear)) {
      frames.push({x:nominal,front,rear}); continue;
    }
    const xs = candidates(aim, lo, hi, slab.xs, half + 0.002);
    // First slide the pair along the row. If a slot runs across the entire bay,
    // keep the rafter aligned and move its individual bearings up/down slope.
    let x = xs.find(a => slab.clear(a, front) && slab.clear(a, rear));
    if (x !== undefined) { frames.push({ x, front, rear }); continue; }
    const ys = [...new Set([front,rear,...candidates(front,ySouth+half,yNorth-half,slab.ys,half+0.002)])];
    let best, cost = Infinity;
    for (x of xs) {
      const clear = ys.filter(y => slab.clear(x,y));
      for (const f of clear) for (const r of clear) {
        if (r - f < width + 0.05) continue; // assumed minimum space between adjacent blocks
        const move = Math.abs(x - aim) + Math.abs(front - f) + Math.abs(rear - r);
        if (move < cost) { cost = move; best = { x, front: f, rear: r }; }
      }
    }
    if (best) frames.push(best);
  }
  return frames;
}

// Extruded section in local XY, member length on Z. ShapeGeometry triangulates
// the re-entrant corners of the C-section and rolled beam end faces.
function section(points) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 }).translate(0, 0, -0.5);
}
const CHANNEL = [[-0.5,-0.5],[0.5,-0.5],[0.5,-0.32],[0.44,-0.32],[0.44,-0.45],[-0.44,-0.45],
  [-0.44,0.45],[0.44,0.45],[0.44,0.32],[0.5,0.32],[0.5,0.5],[-0.5,0.5]];
const I_SECTION = [[-0.5,-0.5],[0.5,-0.5],[0.5,-0.44],[0.035,-0.44],[0.035,0.44],[0.5,0.44],
  [0.5,0.5],[-0.5,0.5],[-0.5,0.44],[-0.035,0.44],[-0.035,-0.44],[-0.5,-0.44]];

function pedestalGeometry(low, pad, height, rubber) {
  const gb = new GB();
  const bottom = -0.5 + rubber/height;
  // Assumed 8 mm oversized EPDM isolation pad. Its bottom coincides with the screed.
  const padWidth = 1 + 0.016/pad;
  // Omit hidden interfaces and the face resting on the roof in the phone mesh.
  function block(w,h,hidden) {
    const box=new THREE.BoxGeometry(w,h,w);
    if (low) {
      const indices=box.index.array;
      box.setIndex(box.groups.filter(g=>!hidden.includes(g.materialIndex))
        .flatMap(g=>Array.from(indices.subarray(g.start,g.start+g.count))));
    }
    return box;
  }
  gb.add(block(padWidth,rubber/height,[3]),
    new THREE.Matrix4().makeTranslation(0,-0.5+rubber/(2*height),0));
  const darkVertices = gb.triCount * 3;
  if (low) {
    gb.add(block(1,0.5-bottom,[3]),
      new THREE.Matrix4().makeTranslation(0,(bottom+0.5)/2,0));
  } else {
    const ring = (radius, level, cut) => [[-radius+cut,-radius],[radius-cut,-radius],[radius,-radius+cut],
      [radius,radius-cut],[radius-cut,radius],[-radius+cut,radius],[-radius,radius-cut],[-radius,-radius+cut]]
      .map(([x,z]) => V(x, level, z));
    const rings = [ring(0.5,bottom,0.032), ring(0.49,0.469,0.032), ring(0.464,0.5,0.025)];
    for (let k=0;k<2;k++) for (let i=0;i<8;i++) {
      const j=(i+1)%8, a=rings[k][i], b=rings[k][j], c=rings[k+1][j], d=rings[k+1][i];
      const n=d.clone().sub(a).cross(b.clone().sub(a)).normalize();
      // The broad cast sides share the yard stamp. Crop plain aggregate for the bevel.
      const stamped = k === 0 && i%2 === 0;
      const uv = stamped ? [[1,0],[0,0],[0,1],[1,1]] : [[0.2,0.2],[0.3,0.2],[0.3,0.28],[0.2,0.28]];
      gb.quad(a,b,c,d,n,uv);
    }
    for (let i=1;i<7;i++) {
      const pts=[rings[2][0],rings[2][i],rings[2][i+1]];
      gb.tri(...pts,UP,...pts.map(v=>[0.34+v.x*0.5,0.45+v.z*0.5]));
    }
  }
  const geo = gb.build();
  const color = new Float32Array(geo.attributes.position.count*3).fill(1);
  color.fill(0.055,0,darkVertices*3);
  geo.setAttribute('color',new THREE.BufferAttribute(color,3));
  return geo;
}

// Static contact darkening supplies the short penumbra below the shadow-map texel size.
function contactMaterial(pad, margin, aniso) {
  const size = 256, data = new Uint8Array(size*size*4);
  const edge = Float32Array.from({length:size},(_,i)=>
    Math.max(0,Math.abs((i+0.5)/size-0.5)*(pad+2*margin)-pad/2)/margin);
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const d = Math.min(1,Math.sqrt(edge[x]*edge[x]+edge[y]*edge[y]));
    const i = (y*size+x)*4, shade = Math.round(255*(1-d)**2);
    data[i]=data[i+1]=data[i+2]=shade; data[i+3]=255;
  }
  const map = new THREE.DataTexture(data,size,size);
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = aniso; map.generateMipmaps = true; map.needsUpdate = true;
  return new THREE.MeshBasicMaterial({color:0x26272a,alphaMap:map,transparent:true,opacity:0.42,
    alphaTest:0.008,depthWrite:false,toneMapped:false});
}

function hexFastener(r, h) {
  // A hex nut with a closed top. The underside lies flat against the base plate.
  const g = new GB();
  const pts = Array.from({length:6},(_,i) => V(r*Math.cos(i*Math.PI/3),h,r*Math.sin(i*Math.PI/3)));
  for (let i=0;i<6;i++) {
    const a=pts[i], b=pts[(i+1)%6], n=a.clone().add(b).setY(0).normalize();
    g.quad(a,b,b.clone().setY(-h),a.clone().setY(-h),n);
  }
  for (let i=1;i<5;i++) g.tri(pts[0],pts[i],pts[i+1],UP);
  return g.build();
}

function clampGeometry(end) {
  const g = new GB();
  // assumed aluminium saddle, stainless hex head, channel nut below the frame.
  g.obox(V(0,0.005,0), V(end ? 0.015 : 0.025,0,0), V(0,0.003,0), V(0,0,0.026));
  const x = end ? 0.009 : 0;
  g.obox(V(x,-0.015,0), V(0.004,0,0), V(0,0.017,0), V(0,0,0.020));
  g.add(hexFastener(0.007,0.003),new THREE.Matrix4().makeTranslation(x,0.011,0));
  return g.build();
}

export function buildStructure(ctx) {
  const { site, quality } = ctx;
  const low = quality === 'low', raised = site.MOUNTING.key === 'elevated';
  const mod = site.MODULE, slope = site.ARRAY_AXES.v, normal = site.ARRAY_AXES.n;
  const n = V(normal[0],normal[2],-normal[1]);
  const roof = site.ROOF.z;
  // assumed square pad, base plate, SHS column, rafter and purlin dimensions in metres
  const pad = raised ? 0.5 : 0.45, rubber = 0.012, padH = (raised ? 0.45 : 0.35) + rubber, spacing = raised ? 4 : 2.8;
  const post = raised ? 0.10 : 0.065, plate = raised ? 0.28 : 0.16;
  const railH = 0.060, railW = 0.040;
  const beamH = raised ? 0.100 : 0.085, beamW = raised ? 0.11 : 0.055;
  const group = new THREE.Group(); group.name = 'pv-table-structure';
  const slab = slabTest(site, pad / 2 + 0.008);
  const penumbra = 0.12; // assumed contact darkening radius, metres
  const contactSlab = slabTest(site,pad/2+0.008+penumbra);
  // Keep the physical scale of zinc flakes and cast aggregate while sampling
  // the medium pattern at twice its former resolution.
  const patternSize = ctx.textureQuality === 'high' ? 256 : 128;
  const texSize = 256;
  const aniso = Math.min(ctx.maxAnisotropy || 1,16);
  const steel = new THREE.MeshStandardMaterial({name:'hot-dip galvanised steel', map:makeGalvTexture(texSize,3,[158,159,157],patternSize),
    metalness:0.61, roughness:0.50, envMapIntensity:0.69});
  const concreteMap = makeConcreteTexture(texSize,5,patternSize);
  steel.map.anisotropy = concreteMap.anisotropy = aniso;
  const concrete = new THREE.MeshStandardMaterial({name:'precast concrete', map:concreteMap, vertexColors:true, roughness:0.91,
    bumpMap:low ? null : concreteMap, bumpScale:0.0018});
  const bright = new THREE.MeshStandardMaterial({name:'clamp and fixing metal', color:0xbcc2c6, roughness:0.36, metalness:0.69});
  const batches = [];
  function batch(name, geo, mat, shadow = true) {
    const list = []; batches.push({name,geo,mat,list,shadow}); return list;
  }
  const box = new THREE.BoxGeometry(1,1,1);
  const blocks = batch('pv-pedestals',pedestalGeometry(low,pad,padH,rubber),concrete);
  const contact = batch('pv-pedestal-contact',new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),
    contactMaterial(pad,penumbra,aniso),false);
  const steelwork = batch('pv-posts-plates-and-braces',box,steel);
  const rails = batch('pv-purlins',low ? box : section(CHANNEL),steel);
  const rafters = batch('pv-rafters',low ? box : section(raised ? I_SECTION : CHANNEL),steel);
  const bolts = low ? null : batch('pv-base-anchors',hexFastener(0.010,0.0075),bright,false);
  const mids = low ? null : batch('pv-mid-clamps',clampGeometry(false),bright,false);
  const ends = low ? null : batch('pv-end-clamps',clampGeometry(true),bright,false);
  function solid(list, center, w, h, d) {
    list.push(new THREE.Matrix4().compose(center,IDENTITY,V(w,h,d)));
  }
  function bar(list, a, b, width, depth, up) {
    const delta = b.clone().sub(a), len = delta.length();
    const z = delta.divideScalar(len), x = up.clone().cross(z).normalize(), y = z.clone().cross(x);
    list.push(new THREE.Matrix4().makeBasis(x,y,z).scale(V(width,depth,len)).setPosition(a.clone().lerp(b,0.5)));
  }
  const tilt = new THREE.Quaternion().setFromAxisAngle(V(1,0,0),Math.asin(slope[2]));
  const flipped = tilt.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP,Math.PI));
  const rearFacing = new THREE.Quaternion().setFromUnitVectors(UP,V(0,0,-1));
  const halfDepth = mod.thickness - 0.002;
  const bondFeet = new Map();
  const details = [];
  for (const t of site.TABLES) {
    const frames = makeFootings(t,pad+0.016,spacing,slab);
    const at = (x,y) => t.zLow + (y-t.ySouth)*slope[2]/slope[1];
    // A vertical offset of depth/cos places the two tilted bearing surfaces in contact.
    const under = (x,y,depth) => V(x,at(x,y)-depth/slope[1],-y);
    const railDepth = halfDepth + railH/2, beamDepth = halfDepth + railH + beamH/2;
    const beamBottom = beamDepth + beamH/2;
    const railYs = [];
    for (let r = 0; r < t.rows; r++) for (const fraction of [0.25,0.75]) {
      const y = t.ySouth + ((mod.length+site.MOUNTING.gap)*r + mod.length*fraction)*slope[1];
      railYs.push(y);
      bar(rails,under(t.x0-0.013,y,railDepth),under(t.x1+0.013,y,railDepth),railW,railH,n);
      if (!low) details.push(() => {
        for (let col = 0; col <= t.cols; col++) {
          const end = col === 0 || col === t.cols;
          const x = col === 0 ? t.x0 : col === t.cols ? t.x1 : t.x0+col*(mod.width+site.MOUNTING.gap)-site.MOUNTING.gap/2;
          (end ? ends : mids).push(new THREE.Matrix4().compose(under(x,y,0),col===0 ? flipped : tilt,UNIT));
        }
      });
    }
    const feet = [];
    for (const frame of frames) {
      const { x,front,rear } = frame;
      // assumed 25 mm past the outer bearing centre; preserve walking headroom at the low eave.
      const ys = Math.min(railYs[0],front)-0.025, yn = Math.max(railYs.at(-1),rear)+0.025;
      bar(rafters,under(x,ys,beamDepth),under(x,yn,beamDepth),beamW,beamH,n);
      for (const y of [front,rear]) {
        const base = roof + padH, top = under(x,y,beamBottom).y;
        solid(blocks,V(x,roof+padH/2,-y),pad,padH,pad);
        if (contactSlab.clear(x,y)) solid(contact,V(x,roof+0.002,-y),pad+2*penumbra,1,pad+2*penumbra);
        feet.push(V(x,base+0.012,-y));
        solid(steelwork,V(x,base+0.006,-y),plate,0.012,plate);
        solid(steelwork,V(x,(base+0.012+top)/2,-y),post,top-base-0.012,post);
        if (!low) details.push(() => {
          for (const dx of [-1,1]) for (const dy of [-1,1]) {
            bolts.push(new THREE.Matrix4().makeTranslation(x+dx*(plate/2-0.019),base+0.019,-y+dy*(plate/2-0.019)));
          }
          if (raised) {
            const sign = y === front ? 1 : -1;
            const inner = y + sign*Math.min(0.48,(rear-front)*0.28); // assumed portal haunch
            bar(steelwork,V(x,top-0.4,-y),under(x,inner,beamBottom),0.053,0.053,UP);
            const overhang = y === front ? y-ys : yn-y;
            if (overhang > 1) { // assumed cantilever strut where a duct forces the bearing inboard
              bar(steelwork,V(x,top-0.65,-y),under(x,y-sign*overhang*0.75,beamBottom),0.065,0.065,UP);
            }
          }
        });
      }
    }
    bondFeet.set(t,feet);
    if (!low) details.push(() => {
      for (const i of new Set([0,frames.length-2])) {
        const a = frames[i], b = frames[i+1]; if (!a || !b) continue;
        const brace = (baseFrame,headFrame,layer) => {
          const offset = post/2 + 0.0035 + layer*0.007; // assumed 7 mm strap bolted against rear post face
          const base = V(baseFrame.x,roof+padH+0.045,-baseFrame.rear-offset);
          const head = under(headFrame.x,headFrame.rear,beamBottom+0.044);
          head.z -= offset;
          bar(steelwork,base,head,0.007,0.041,UP);
          for (const p of [base,head]) {
            bolts.push(new THREE.Matrix4().compose(p.clone().add(V(0,0,-0.010)),rearFacing,UNIT));
          }
        };
        brace(a,b,0);
        if (raised) brace(b,a,1);
      }
    });
  }
  function instances(name,geo,mat,list,capacity=list.length) {
    const mesh=new THREE.InstancedMesh(geo,mat,capacity);
    mesh.name=name; mesh.count=list.length;
    list.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));
    return mesh;
  }
  function registerSteel(mesh) {
    mesh.castShadow=mesh.receiveShadow=true;
    mesh.userData.occluderCategory='solar';
    group.add(mesh); ctx.registerOccluder?.(mesh);
  }
  const rafterBounds = new THREE.Box3(), unitBounds = new THREE.Box3(V(-.5,-.5,-.5),V(.5,.5,.5));
  for (const matrix of rafters) rafterBounds.union(unitBounds.clone().applyMatrix4(matrix));
  group.userData.minRafterClearance = rafterBounds.min.y-roof;

  if (!low) {
    // Before instancing, these UVs were projected on the finished members.
    // Project in the vertex shader to preserve that physical zinc grain scale.
    steel.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 memberPos=(instanceMatrix*vec4(position,1.0)).xyz;
        mat3 basis=mat3(instanceMatrix);
        vec3 face=abs(basis*(normal/vec3(dot(basis[0],basis[0]),dot(basis[1],basis[1]),dot(basis[2],basis[2]))));
        vMapUv=vec2(face.x>face.y && face.x>face.z ? memberPos.z : memberPos.x,
                    face.y>=face.x && face.y>=face.z ? memberPos.z : memberPos.y)*3.5;`);
    };
    registerSteel(instances('pv-purlins',batches.find(b=>b.list===rails).geo,steel,rails));
    registerSteel(instances('pv-rafters',batches.find(b=>b.list===rafters).geo,steel,rafters));
  } else {
    steelwork.push(...rails,...rafters);
  }
  // Leave room for two haunches per bearing, four rear straps per table and
  // a nine-segment bond. Append them to the existing draw call after paint.
  const baseCount=steelwork.length;
  const capacity=baseCount+site.TABLES.length*13+(raised && !low ? blocks.length*2 : 0);
  const metal=instances('pv-columns-rafters-purlins-and-braces',box,steel,steelwork,capacity);
  registerSteel(metal);
  function publish(list) {
    const {name,geo,mat,shadow}=batches.find(b=>b.list===list);
    const mesh=instances(name,geo,mat,list);
    mesh.castShadow=shadow; mesh.receiveShadow=list!==contact;
    if (list===contact) mesh.raycast=()=>{};
    group.add(mesh);
  }
  publish(blocks); publish(contact);
  // Matrices already live in GPU-ready buffers. Only deferred additions remain.
  for (const list of [rails,rafters,steelwork,blocks,contact]) list.length=0;

  async function finish() {
    let start=performance.now();
    for (const build of details) {
      build();
      if (performance.now()-start>20) { await ctx.breathe(); start=performance.now(); }
    }
    details.length=0;
    // Assumed 25 x 3 mm jumpers fold around each block to the terrace.
    const bondSlab = slabTest(site,0.019,false);
    const previous = new Map();
    for (const [table,feet] of bondFeet) {
      if (performance.now()-start>20) { await ctx.breathe(); start=performance.now(); }
      const neighbours = previous.get(table.array) || [];
      let distance = Infinity, pair;
      for (const other of neighbours) for (const a of other) for (const b of feet) {
        const d = a.distanceTo(b);
        if (d < distance && d < 3.3) { distance=d; pair=[a,b]; }
      }
      neighbours.push(feet); previous.set(table.array,neighbours);
      if (!pair) continue;
      const [a,b] = pair, dir = b.clone().sub(a).normalize();
      const dominant = Math.max(Math.abs(dir.x),Math.abs(dir.z));
      const pathFrom = (p,sign) => {
        const offset = m => p.clone().addScaledVector(dir,sign*m/dominant);
        return [offset(plate/2-0.016), offset(plate/2+0.002),
          offset(plate/2+0.008).setY(p.y-0.011), offset(pad/2+0.009).setY(p.y-0.011),
          offset(pad/2+0.014).setY(roof+0.003)];
      };
      const path = [...pathFrom(a,1),...pathFrom(b,-1).reverse()];
      const floorA=path[4], floorB=path[5];
      const steps=Math.ceil(floorA.distanceTo(floorB)/0.07);
      if (Array.from({length:steps+1},(_,i)=>floorA.clone().lerp(floorB,i/steps))
        .some(p=>!bondSlab.clear(p.x,-p.z))) continue;
      for (let i=1;i<path.length;i++) bar(steelwork,path[i-1],path[i],0.025,0.003,UP);
    }
    for (const matrix of steelwork) metal.setMatrixAt(metal.count++,matrix);
    metal.instanceMatrix.needsUpdate=true;
    metal.computeBoundingSphere();
    if (!low) for (const list of [bolts,mids,ends]) { publish(list); list.length=0; }
    steelwork.length=0;
    bondFeet.clear();
    ctx.invalidate();
    await ctx.breathe();
  }
  return {group,finish};
}
