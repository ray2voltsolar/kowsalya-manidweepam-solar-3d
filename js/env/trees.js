import { rng, makeCanvas, GeoBuilder, addTube, completeMips, patchFoliage, heightToNormal, fbm } from './util.js';

import { planting } from './layout.js';
const QT = { high: { frondSeg: 12, tex: 1024, trunkRad: 9 }, medium: { frondSeg: 9, tex: 512, trunkRad: 7 }, low: { frondSeg: 6, tex: 256, trunkRad: 6 } };

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------
function frondTexture(THREE, size) {
  const W = size / 4, H = size;               // u across (0..1), v along (0 base .. 1 tip)
  const c = makeCanvas(W, H); const g = c.getContext('2d');
  const r = rng(41);
  const Y = (v) => (1 - v) * H;
  // leaflets
  for (const side of [-1, 1]) {
    for (let v = 0.1; v < 0.99; v += 0.0085 + r() * 0.004) {
      if (r() < 0.07) continue;                                  // torn / missing leaflet
      const prof = Math.sin(Math.PI * Math.min(1, (v - 0.06) / 0.98)) ** 0.5;
      const L = (0.62 + r() * 0.36) * (W / 2) * Math.max(0.35, prof);
      const x0 = W / 2, y0 = Y(v);
      const fwd = (0.10 + r() * 0.05) * H * (0.5 + 0.5 * prof);  // leaflets sweep towards the tip
      const x1 = x0 + side * L, y1 = y0 - fwd * 0.55;
      const cx = x0 + side * L * 0.45, cy = y0 - fwd * 0.05;
      const gcol = [52 + r() * 34, 86 + r() * 34, 24 + r() * 18];
      if (r() < 0.12) { gcol[0] += 45; gcol[1] += 25; }            // yellowing leaflet
      const wdt = (0.013 + r() * 0.004) * H;
      g.fillStyle = `rgb(${gcol[0] | 0},${gcol[1] | 0},${gcol[2] | 0})`;
      g.beginPath();
      g.moveTo(x0, y0 - wdt * 0.5);
      g.quadraticCurveTo(cx, cy - wdt, x1, y1);
      g.quadraticCurveTo(cx, cy + wdt * 0.6, x0, y0 + wdt * 0.5);
      g.closePath(); g.fill();
      // midrib highlight
      g.strokeStyle = `rgba(${gcol[0] + 40 | 0},${gcol[1] + 40 | 0},${gcol[2] + 20 | 0},0.6)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy - wdt * 0.2, x1, y1); g.stroke();
    }
  }
  // rachis (petiole), thick at base
  for (let v = 0; v < 1; v += 0.004) {
    const w = (1 - v) * 0.09 * W + 2;
    g.fillStyle = `rgb(${150 - v * 50 | 0},${150 - v * 40 | 0},${70 - v * 20 | 0})`;
    g.fillRect(W / 2 - w / 2, Y(v) - 2, w, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function barkTexture(THREE, palm) {
  const W = 128, H = 256;
  const c = makeCanvas(W, H); const g = c.getContext('2d');
  const h = makeCanvas(W, H); const hg = h.getContext('2d');
  const img = g.createImageData(W, H), hi = hg.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    let ht, col;
    if (palm) {
      // leaf-scar rings: ~9 per texture repeat (0.9 m), slightly wavy
      const ring = (v * 9 + 0.05 * Math.sin(u * Math.PI * 2 * 2 + v * 20)) % 1;
      const groove = Math.exp(-((ring - 0.15) ** 2) / 0.004);
      const n = fbm(u * 8, v * 16, 3, 5, 8);
      ht = 0.7 - groove * 0.6 + n * 0.25;
      const l = 0.55 + n * 0.35 - groove * 0.3;
      col = [128 * l + 20, 118 * l + 18, 104 * l + 14];
    } else {
      const n = fbm(u * 6, v * 3, 4, 9, 6), m = fbm(u * 20, v * 4, 2, 3, 20);
      const fiss = Math.abs(Math.sin((u * 7 + n * 0.8) * Math.PI));
      ht = fiss * 0.7 + m * 0.3;
      const l = 0.45 + fiss * 0.35 + m * 0.2;
      col = [96 * l + 20, 84 * l + 18, 70 * l + 14];
    }
    const i = (y * W + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = ht * 255; hi.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); hg.putImageData(hi, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const nt = new THREE.CanvasTexture(heightToNormal(h, 3)); nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
  return { map: completeMips(t), normalMap: completeMips(nt) };
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------
function buildPalm(gbTrunk, gbFronds, gbNuts, x, y, H, seed, q) {
  const r = rng(seed);
  
  const az = r() * Math.PI * 2;
  const lean = H * (0.05 + r() * 0.09);
  const dx = Math.cos(az), dz = Math.sin(az);
  const base = [x, 0, -y];
  // curved trunk: leans out, then curves slightly back up
  const pts = [], radii = []; const N = 18;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const off = lean * (Math.sin(t * Math.PI * 0.5) * 1.0 - 0.15 * t * t);
    pts.push([base[0] + dx * off, t * H, base[2] + dz * off]);
    radii.push(0.15 + 0.07 * (1 - t) + 0.16 * Math.exp(-t * H / 0.55));
  }
  pts[0][1] = -0.05;
  const sScale = H / 13;
  addTube(gbTrunk, pts, radii, q.trunkRad, 0.9, [1, 1, 1]);
  const top = pts[N];
  // crown shaft / bole (leaf bases) — cone, darker
  const bole = [];
  for (let k = 0; k <= 4; k++) { const t = k / 4; bole.push([top[0], top[1] - 0.25 + t * 1.0, top[2]]); }
  addTube(gbNuts, bole, [0.24, 0.3, 0.32, 0.22, 0.05], 8, 1, (t) => [0.2 + t * 0.06, 0.17 + t * 0.08, 0.09], true);
  // coconuts
  const nNuts = 3 + Math.floor(r() * 4);
  for (let k = 0; k < nNuts; k++) {
    const a = r() * 6.28, rr = 0.3 + r() * 0.12, hy = top[1] - 0.05 - r() * 0.35;
    const cx = top[0] + Math.cos(a) * rr, cz = top[2] + Math.sin(a) * rr;
    const rad = 0.1 + r() * 0.03;
    const col = r() < 0.7 ? [0.2 + r() * 0.06, 0.26 + r() * 0.06, 0.06] : [0.32, 0.22, 0.09];
    const seg = 4;
    // tiny lat-long sphere
    const rows = [];
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI; const row = [];
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2;
        const nrm = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        row.push(gbNuts.vert([cx + nrm[0] * rad, hy + nrm[1] * rad * 1.1, cz + nrm[2] * rad], nrm, [0, 0], col));
      }
      rows.push(row);
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) gbNuts.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
  }
  // fronds
  const nF = 21 + Math.floor(r() * 5);
  const golden = 2.39996;
  for (let f = 0; f < nF; f++) {
    const fa = f * golden + r() * 0.3;
    const age = f / nF;                         // 0 = youngest (upright) … 1 = oldest (drooping)
    const dead = age > 0.8 && r() < 0.75;          // a skirt of brown hanging fronds
    const yel = Math.max(0, (age - 0.55) / 0.35);    // older live fronds yellow towards the tips
    const el = (dead ? -1.25 : 0.95 - age * 1.35) + (r() - 0.5) * 0.25;
    const L = (dead ? 3.4 : 4.0 + r() * 1.3) * Math.min(1.15, Math.max(0.8, sScale));
    const bend = dead ? 0.25 : 0.95 + r() * 0.55 + age * 0.5;
    const hw = (dead ? 0.42 : 0.62 + r() * 0.18) * Math.min(1.1, sScale);
    const lv = 0.8 + r() * 0.12;                     // ≈15 % darker, less saturated crown than before
    const tint = dead ? [0.78 + r() * 0.12, 0.55 + r() * 0.08, 0.3] :
      [lv * (0.94 + yel * 0.3), lv * (0.92 + yel * 0.1), lv * (0.86 - yel * 0.2)];
    const ca = Math.cos(fa), sa = Math.sin(fa);
    let p = [top[0] + ca * 0.18, top[1] + 0.45 - age * 0.35, top[2] + sa * 0.18];
    const segs = q.frondSeg; const step = L / segs;
    const rows = [];
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      const ang = el - bend * Math.pow(s, 1.4);
      const tdir = [ca * Math.cos(ang), Math.sin(ang), sa * Math.cos(ang)];
      // side vector (horizontal, perpendicular to the frond's azimuth) with a little twist along the frond
      const tw = (r() - 0.5) * 0.04 + s * 0.25 * (f % 2 ? 1 : -1);
      let side = [-sa, 0, ca];
      side = [side[0] * Math.cos(tw), Math.sin(tw), side[2] * Math.cos(tw)];
      const prof = Math.min(1, s * 6) * (1 - 0.45 * s * s) * hw;
      const droop = prof * (dead ? 0.9 : 0.62 + s * 0.3);
      // leaflet plane normal ≈ up-ish, tilted
      const up = [-(tdir[0] * tdir[1]), 1 - tdir[1] * tdir[1], -(tdir[2] * tdir[1])];
      const ul = Math.hypot(...up) || 1;
      const nUp = up.map((v) => v / ul);
      
      const L0 = [p[0] - side[0] * prof - nUp[0] * droop, p[1] - side[1] * prof - nUp[1] * droop, p[2] - side[2] * prof - nUp[2] * droop];
      const R0 = [p[0] + side[0] * prof - nUp[0] * droop, p[1] + side[1] * prof - nUp[1] * droop, p[2] + side[2] * prof - nUp[2] * droop];
      const nL = [nUp[0] - side[0] * 0.4, nUp[1] - side[1] * 0.4 + 0.3, nUp[2] - side[2] * 0.4];
      const nR = [nUp[0] + side[0] * 0.4, nUp[1] + side[1] * 0.4 + 0.3, nUp[2] + side[2] * 0.4];
      const nn = (v) => { const l = Math.hypot(...v) || 1; return v.map((a) => a / l); };
      rows.push([
        gbFronds.vert(L0, nn(nL), [0, s], tint),
        gbFronds.vert(p.slice(), nn([nUp[0], nUp[1] + 0.3, nUp[2]]), [0.5, s], tint),
        gbFronds.vert(R0, nn(nR), [1, s], tint),
      ]);
      p = [p[0] + tdir[0] * step, p[1] + tdir[1] * step, p[2] + tdir[2] * step];
    }
    for (let k = 0; k < segs; k++) {
      gbFronds.quad(rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]);
      gbFronds.quad(rows[k][1], rows[k][2], rows[k + 1][2], rows[k + 1][1]);
    }
  }
}

// ---------------------------------------------------------------------------
// broadleaf crown (cards) — shared by hero trees and instanced context trees
// ---------------------------------------------------------------------------
function addCrown(gb, cx, cy, cz, rx, ry, nCards, cardSize, seed, tint = [1, 1, 1]) {
  const r = rng(seed);
  const nCl = 4 + Math.floor(r() * 4);
  const cl = [];
  for (let k = 0; k < nCl; k++) {
    const a = r() * 6.28, rr = r() * 0.45, hy = (r() - 0.35) * 0.5;
    cl.push([cx + Math.cos(a) * rx * rr, cy + hy * ry, cz + Math.sin(a) * rx * rr, 0.5 + r() * 0.25]);
  }
  for (let k = 0; k < nCards; k++) {
    const c = cl[Math.floor(r() * nCl)];
    // point on a shell (biased to outside)
    let d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]; let dl = Math.hypot(...d) || 1; d = d.map((v) => v / dl);
    const shell = 0.55 + Math.pow(r(), 0.5) * 0.45;
    const px = c[0] + d[0] * rx * c[3] * shell * 1.25, py = c[1] + d[1] * ry * c[3] * shell * 1.3, pz = c[2] + d[2] * rx * c[3] * shell * 1.25;
    // card orientation: random normal, biased outward
    let nrm = [d[0] * 0.6 + (r() - 0.5), d[1] * 0.6 + (r() - 0.5) + 0.25, d[2] * 0.6 + (r() - 0.5)];
    const nl = Math.hypot(...nrm) || 1; nrm = nrm.map((v) => v / nl);
    let a1 = Math.abs(nrm[1]) < 0.95 ? [nrm[2], 0, -nrm[0]] : [1, 0, 0];
    const al = Math.hypot(...a1); a1 = a1.map((v) => v / al);
    const a2 = [nrm[1] * a1[2] - nrm[2] * a1[1], nrm[2] * a1[0] - nrm[0] * a1[2], nrm[0] * a1[1] - nrm[1] * a1[0]];
    const rot = r() * 6.28, cr = Math.cos(rot), sr = Math.sin(rot);
    const e1 = a1.map((v, i) => v * cr + a2[i] * sr), e2 = a1.map((v, i) => -v * sr + a2[i] * cr);
    const sz = cardSize * (0.75 + r() * 0.5) / 2;
    // lighting normal: spherical from the crown centre (soft, volumetric look)
    let sn = [px - cx, (py - cy) * 1.2 + ry * 0.3, pz - cz]; const snl = Math.hypot(...sn) || 1; sn = sn.map((v) => v / snl);
    const ln = sn.map((v, i) => v * 0.8 + nrm[i] * 0.2);
    // AO: darker towards the inside and the bottom
    const rad = Math.hypot((px - cx) / rx, (py - cy) / ry, (pz - cz) / rx);
    const ao = Math.min(1, 0.45 + rad * 0.5) * (0.78 + 0.22 * Math.max(0, Math.min(1, (py - cy) / ry * 0.5 + 0.6)));
    const hue = 0.88 + r() * 0.24;
    const col = [tint[0] * ao * hue, tint[1] * ao * (0.94 + r() * 0.12), tint[2] * ao * hue];
    
    const v = [];
    for (const [s1, s2, u, w] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      v.push(gb.vert([px + (e1[0] * s1 + e2[0] * s2) * sz, py + (e1[1] * s1 + e2[1] * s2) * sz, pz + (e1[2] * s1 + e2[2] * s2) * sz], ln, [u, w], col));
    }
    gb.quad(v[0], v[1], v[2], v[3]);
  }
}

// Each leaf spray grows out of a fork. Keep the inner boughs visible through the crown.
function buildBroadleaf(wood,leaves,seed,quality){
  const low=quality==='low',medium=quality==='medium';
  const r=rng(seed),main=[[0,-.04,0],[.03,.27,.03],[.11,1.94,.10],[-.11,3.52,.17],[.20,5.12,.05],[.17,6.1,.23]];
  addTube(wood,main,[.285,.225,.163,.135,.084,.035],low?6:9,1.36);
  const mix=(a,b,f)=>a.map((v,i)=>v+(b[i]-v)*f);
  function spray(base,angle,rise,len,width) {
    const dx=Math.cos(angle),dz=Math.sin(angle),cant=(r()-.5)*1.1;
    const norm=[dx*.33,.8+rise*.16,dz*.33];
    const v=[],tint=.66+.32*r()+.15*(base[1]-5)/3,col=[tint*.94,tint,tint*.86];
    for(const [u,t] of [[0,0],[1,0],[1,1],[0,1]]){
      const across=(u-.5)*width,along=t*len;
      v.push(leaves.vert([base[0]+dx*along-dz*across,base[1]+rise*t+across*cant,base[2]+dz*along+dx*across],norm,[u,t],col));
    }
    leaves.quad(...v);
  }
  const count=low?7:9;
  for(let i=0;i<count;i++){
    const tier=i/(count-1),a=i*2.40+r()*.42;
    const u=(tier*.93+.045)*3,section=Math.floor(u)+2;
    const base=mix(main[section],main[section+1],u%1);
    const reach=(2.0-.88*tier)*(1+r()*.19);
    const mid=[base[0]+Math.cos(a)*reach*.49,base[1]+1.06,base[2]+Math.sin(a)*reach*.51];
    const end=[base[0]+Math.cos(a)*reach,4.65+2.58*tier+r()*.26,base[2]+Math.sin(a)*reach];
    addTube(wood,[base,mid,end],[.104-.045*tier,.067-.025*tier,.026],low?4:6,1.36);
    const forks=low?3:medium?4:5;
    for(let j=0;j<forks;j++){
      const start=mix(mid,end,.20+.78*j/(forks-1));
      const dir=a+(j%2?1:-1)*(.39+r()*1.06),len=.68+r()*.44;
      const tip=[start[0]+Math.cos(dir)*len,start[1]+.27+r()*.59,start[2]+Math.sin(dir)*len];
      addTube(wood,[start,tip],[.037,.009],low?3:4,1.36);
      const sprays=low?6:medium?8:11;
      for(let t=0;t<sprays;t++){
        const f=.14+.84*t/(sprays-1),root=mix(start,tip,f);
        const az=dir+(t%2?1:-1)*(.27+1.40*r());
        spray(root,az,.63*(1-f)-.88*r()+.22,(.63+r()*.48)*(low?1.27:1),(.79+r()*.48)*(low?1.23:1));
      }
    }
  }
}

// A spray silhouette has twigs, leaf pairs, open notches and individual shaded leaf blades.
function sprayTexture(THREE,size) {
  const c=makeCanvas(size,size),g=c.getContext('2d'),r=rng(432);
  g.scale(size,size);
  function twig(ax,ay,bx,by,w){
    g.beginPath();g.moveTo(ax,ay);g.lineTo(bx,by);g.strokeStyle=w>.007?'#66573a':'#76804a';g.lineWidth=w;g.stroke();
  }
  function leaf(x,y,dx,dy,length,wide) {
    g.save();g.translate(x,y);g.rotate(Math.atan2(dy,dx));
    const tint=r(), red=53+43*tint+10*r(), green=70+38*tint+14*r(), blue=32+22*tint;
    g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(length*.48,-wide,length,0);g.quadraticCurveTo(length*.55,wide*.94,0,0);
    g.fillStyle='rgb('+[red,green,blue].map(Math.round).join(',')+')';g.fill();
    g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(length*.50,-wide*.75,length*.98,0);g.closePath();g.fillStyle='rgba(232,223,148,.19)';g.fill();g.restore();
  }
  const base=[.45,.97];
  for(let s=0;s<13;s++){
    const angle=-Math.PI*.98+(s+.45)/13*Math.PI*.96;
    const start=[base[0]+.07*Math.sin(s),base[1]-.14*Math.sin(s*.7)**2];
    const dx=Math.cos(angle)*.48,dy=-.34+Math.sin(angle)*.48;
    twig(...start,start[0]+dx,start[1]+dy,.007);
    for(let i=1;i<11;i++) {
      const f=i/12,px=start[0]+dx*f,py=start[1]+dy*f;
      for(const side of [-1,1]){
        const len=(.042+.036*r())*(.75+.35*Math.sin(f*Math.PI));
        const vx=dx*.38-side*dy,vy=dy*.38+side*dx;
        leaf(px,py,vx,vy,len,.013+r()*.013);
      }
    }
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

// A whole twig spray per card keeps the fine, torn silhouette of low thorn
// scrub at print scale. Texture gaps expose the woody forks near the roots.
function thornTexture(THREE,size) {
  const canvas=makeCanvas(size,size),g=canvas.getContext('2d'),rand=rng(927);
  g.scale(size,size);g.lineCap='round';
  function twig(x,y,dx,dy,level) {
    const ex=x+dx,ey=y+dy;
    g.beginPath();g.moveTo(x,y);g.quadraticCurveTo(x+dx*.38,y+dy*.53,ex,ey);
    g.lineWidth=[.004,.007,.012][level];g.strokeStyle=level?'#716047':'#867955';g.stroke();
    if(level){
      for(let i=0;i<4;i++){
        const t=.35+i*.18;
        twig(x+t*dx,y+t*dy,dx*.40+(i%2?1:-1)*(.038+rand()*.076),dy*(.39+rand()*.22),level-1);
      }
    } else {
      for(let i=0;i<12;i++){
        const t=.18+rand()*.82,light=rand(),w=.009+rand()*.012;
        const lx=x+dx*t+(rand()-.5)*.047,ly=y+dy*t+(rand()-.5)*.035;
        g.fillStyle='rgb('+[91+49*light,92+42*light,54+32*light].map(Math.round).join(',')+')';
        g.beginPath();g.ellipse(lx,ly,w,w*.48,rand()*Math.PI,0,2*Math.PI);g.fill();
      }
    }
  }
  for(let i=0;i<9;i++)twig(.46+rand()*.12,.97,(i-4)*.060+(rand()-.5)*.047,-.30-rand()*.18,2);
  const t=new THREE.CanvasTexture(canvas);
  t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

function thornCrown(low) {
  const gb=new GeoBuilder(),rand=rng(991);
  const count=low?5:8;
  for(let i=0;i<count;i++){
    const a=i*2.4+rand()*.33,dx=Math.cos(a),dz=Math.sin(a);
    const height=.68+rand()*.32,reach=.43+rand()*.47,width=.59+rand()*.32;
    const row=(t,across)=>{
      const r=.04+reach*t;
      return gb.vert([dx*r-dz*across*width,t*height,dz*r+dx*across*width],
        [dx*.54,.84,dz*.54],[(across+1)/2,t],t?[.96,.96,.87]:[.52,.48,.37]);
    };
    gb.quad(row(0,-1),row(0,1),row(1,1),row(1,-1));
  }
  return gb;
}

export function buildTrees(ctx,parent) {
  const {THREE,site}=ctx,q=QT[ctx.quality]||QT.high,low=ctx.quality==='low';
  const positions=planting(site),r=rng(463);
  const bark=barkTexture(THREE,false);
  const trunk=new THREE.MeshStandardMaterial({map:bark.map,normalMap:bark.normalMap,roughness:.95,color:0xc2b7a0});
  const leafMap=sprayTexture(THREE,low?256:384);
  function foliage(map) {
    completeMips(map);
    const mat=new THREE.MeshStandardMaterial({map,roughness:.87,side:THREE.DoubleSide,alphaTest:.31,vertexColors:true});
    return patchFoliage(mat);
  }
  const crown=foliage(leafMap);
  const add=(mesh,name,cast=true)=>{
    mesh.name=name;mesh.castShadow=cast;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  function instances(gb,mat,points,name,color,scaleH,scaleR) {
    if(!points.length)return;
    const mesh=new THREE.InstancedMesh(gb.build(THREE,{color}),mat,points.length);
    const o=new THREE.Object3D();
    points.forEach(([x,y,h,rad,az,tint],i)=>{
      o.position.set(x,0,-y);o.rotation.y=az;o.scale.set(rad/scaleR,h/scaleH,rad/scaleR);o.updateMatrix();
      mesh.setMatrixAt(i,o.matrix);if(color)mesh.setColorAt(i,new THREE.Color(tint));
    });
    mesh.computeBoundingSphere();return add(mesh,name);
  }
  const withVariation=(pts,palette)=>pts.map(p=>[...p,r()*Math.PI*2,palette[Math.floor(r()*palette.length)]]);
  const treeSites=positions.trees.filter(([x,y],i)=>!low || site.pointInRing(x,y,site.COMPOUND.polygon) || i%3!==1);
  const trees=withVariation(treeSites,[0xe0dfb4,0xc9d3b6,0xfcf0c3,0xcfddc0]);
  for(let i=0;i<3;i++){
    const pts=trees.filter((p,index)=>index%3===i);
    const wood=new GeoBuilder(), leaves=new GeoBuilder();
    buildBroadleaf(wood,leaves,739+i*119,ctx.quality);
    instances(wood,trunk,pts,'Shade trees · branches '+i,false,8,3.4);
    instances(leaves,crown,pts,'Shade trees · foliage '+i,true,8,3.4);
  }
  if(positions.palms.length){
    const wood=new GeoBuilder(),leaves=new GeoBuilder(),nuts=new GeoBuilder();
    positions.palms.forEach(([x,y,h],i)=>buildPalm(wood,leaves,nuts,x,y,h,284+i,q));
    const palmBark=barkTexture(THREE,true);
    add(new THREE.Mesh(wood.build(THREE),new THREE.MeshStandardMaterial({map:palmBark.map,normalMap:palmBark.normalMap,roughness:.94})),'Avenue palms · trunks');
    add(new THREE.Mesh(leaves.build(THREE,{color:true}),foliage(frondTexture(THREE,q.tex))),'Avenue palms · fronds');
    add(new THREE.Mesh(nuts.build(THREE,{color:true}),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8})),'Avenue palms · leaf bases');
  }
  const shrubCards=new GeoBuilder();
  addCrown(shrubCards,0,.49,0,.88,.38,low?17:ctx.quality==='medium'?30:43,.72,638,[1,.96,.78]);
  const tuft=new GeoBuilder();
  for(let blade=0;blade<(low?7:15);blade++){
    const a=r()*Math.PI*2, dx=Math.cos(a),dz=Math.sin(a),rad=r()*.25,wide=.018+r()*.014;
    const x=dx*rad,z=dz*rad,h=.44+r()*.54,reach=.17+r()*.26,normal=[dx*.65,.76,dz*.65];
    const corners=[[0,-1],[0,1],[.61,1],[.61,-1],[1,0]].map(([t,s])=>{
      const d=reach*t*t;
      return tuft.vert([x+dx*d-dz*wide*s,t*h,z+dz*d+dx*wide*s],normal,[0,0],t<.1?[.30,.27,.16]:[.76,.68,.40]);
    });
    tuft.quad(...corners.slice(0,4));tuft.tri(corners[3],corners[2],corners[4]);
  }
  const cover=positions.tufts.filter((p,i)=>!low||i%7===0);
  const dryGrass=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});
  const tussocks=instances(tuft,dryGrass,withVariation(cover,[0xc6b38c,0xb7aa78,0xa5a478]),'Seasonal grass tussocks',true,1,1);
  if(tussocks)tussocks.castShadow=false;
  const shrubs=positions.shrubs.filter((p,i)=>!low||i%3!==0);
  const shrubHeight=Math.max(...shrubCards.p.filter((_,i)=>i%3===1));
  instances(shrubCards,crown,withVariation(shrubs,[0xf1deac,0xc5cfa3,0xb9c891,0xe4d1aa]),'Garden shrubs and seasonal scrub',true,shrubHeight,1);
  return cover=>{
    const points=positions.fieldSites(cover,ctx.quality);
    if(!points.length)return;
    const fieldMaterial=foliage(thornTexture(THREE,low?128:256));
    const palette=[0xe1d9b4,0xd3c7a2,0xd1c080,0xafb396,0xf1dab2];
    instances(thornCrown(low),fieldMaterial,withVariation(points,palette),'Dry thorn scrub on stream banks',true,1,1);
  };
}
