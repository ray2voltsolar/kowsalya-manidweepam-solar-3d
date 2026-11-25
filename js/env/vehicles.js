import { GeoBuilder, makeCanvas, completeMips } from './util.js';
import { roadAt, vehicles } from './layout.js';
class Kit {
  constructor(THREE, low) { this.low=low;
    this.THREE = THREE;

    this.gb = { paint: new GeoBuilder(), paintSolid: new GeoBuilder(), glass: new GeoBuilder(), rubber: new GeoBuilder(), steel: new GeoBuilder(),
      dark: new GeoBuilder(), lights: new GeoBuilder(), chrome: new GeoBuilder() };
    this.M = new THREE.Matrix4();
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
  }
  begin(x, y, headingDeg, roll = 0) {
    const T = this.THREE;
    const phi = (90 - headingDeg) * Math.PI / 180;
    this.M.compose(new T.Vector3(x, 0, -y), new T.Quaternion().setFromEuler(new T.Euler(roll, phi, 0, 'YXZ')), new T.Vector3(1, 1, 1));

  }
  add(geo, mat, color = [1, 1, 1], local = null) {
    const T = this.THREE;
    const L = local || new T.Matrix4();
    const W = new T.Matrix4().multiplyMatrices(this.M, L);
    const NW = new T.Matrix3().getNormalMatrix(W);
    const v = this._v, n = this._n;
    this.gb[mat].addGeometry(geo, (p, nn) => {
      v.set(p[0], p[1], p[2]).applyMatrix4(W); n.set(nn[0], nn[1], nn[2]).applyMatrix3(NW).normalize();
      return [[v.x, v.y, v.z], [n.x, n.y, n.z]];
    }, color);
    geo.dispose();
  }
  box(mat, color, cx, cy, cz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const T = this.THREE;
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(1, 1, 1));
    this.add(new T.BoxGeometry(sx, sy, sz), mat, color, L);
  }
  cyl(mat, color, cx, cy, cz, r0, r1, h, axis = 'z', seg = 16, open = false) {
    const T = this.THREE;
    const q = new T.Quaternion();
    if (axis === 'z') q.setFromEuler(new T.Euler(Math.PI / 2, 0, 0)); else if (axis === 'x') q.setFromEuler(new T.Euler(0, 0, Math.PI / 2));
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), q, new T.Vector3(1, 1, 1));
    this.add(new T.CylinderGeometry(r1, r0, h, this.low ? Math.min(8,seg) : seg, 1, open), mat, color, L);
  }
  /** wheel with tyre (torus-ish profile via lathe), rim and hub; axle along Z */
  wheel(cx, cy, cz, r, w, rimColor = [0.52, 0.53, 0.55], seg = 22, solidRim = true) {
    const T = this.THREE;
    const pts = []; seg=this.low?10:26;
    const ri = r * 0.64;
    for (let k = 0; k <= 4; k++) {
      const a = -Math.PI / 2 + (k / 4) * Math.PI;
      pts.push(new T.Vector2(r - w * 0.18 + Math.cos(a) * w * 0.18, Math.sin(a) * w * 0.5));
    }
    const prof = [new T.Vector2(ri, -w * 0.45), ...pts, new T.Vector2(ri, w * 0.45)];
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2, 0, 0)), new T.Vector3(1, 1, 1));
    // lathe around Y then rotate Y→Z
    const tyre = new T.LatheGeometry(prof.map((p) => new T.Vector2(p.x, p.y)), seg);
    this.add(tyre, 'rubber', [1, 1, 1], L);
    const side = Math.sign(cz) || 1;
    if (solidRim) this.cyl('steel', rimColor, cx, cy, cz + side * w * 0.12, ri * 1.02, ri * 1.02, w * 0.7, 'z', 16);
    else return;
    this.cyl('dark', [0.25, 0.25, 0.26], cx, cy, cz + side * w * 0.36, ri * 0.35, ri * 0.35, 0.02, 'z', 10);
  }
  /** extruded side profile (shape in XY), width along Z, optional top taper (tumblehome) */
  profile(mat, color, pts, width, { bevel = 0.05, taperY0 = null, taperY1 = null, taper = 1, zc = 0, curve = 6 } = {}) {
    const T = this.THREE;
    const sh = new T.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
    const depth = Math.max(0.01, width - 2 * bevel);
    const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelSize: bevel * 0.8, bevelThickness: bevel, bevelSegments: this.low ? 1 : 2, curveSegments: curve });
    g.translate(0, 0, -depth / 2 + zc);
    if (taperY0 !== null) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i); const t = Math.max(0, Math.min(1, (y - taperY0) / (taperY1 - taperY0)));
        p.setZ(i, zc + (p.getZ(i) - zc) * (1 - (1 - taper) * t));
      }
      g.computeVertexNormals();
    }
    this.add(g, mat, color);
  }
  /** tube between two local points */
  rod(mat, color, a, b, r, seg = 8) {
    const T = this.THREE;
    const A = new T.Vector3(...a), B = new T.Vector3(...b);
    const d = B.clone().sub(A); const len = d.length();
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    const L = new T.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new T.Vector3(1, 1, 1));
    this.add(new T.CylinderGeometry(r, r, len, seg, 1, true), mat, color, L);
  }
  /** torus arc in the XY plane (axle along Z), angles from +X counter-clockwise */
  arc(mat, color, cx, cy, cz, R, r, a0, a1, seg = 16, rseg = 6, sz = 1) {
    const T = this.THREE;
    const g = new T.TorusGeometry(R, r, rseg, seg, a1 - a0);
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(0, 0, a0)), new T.Vector3(1, 1, sz));
    this.add(g, mat, color, L);
  }
  /** fender / mudguard shell: partial open cylinder about Z, angles from +X counter-clockwise */
  shell(mat, color, cx, cy, cz, R, w, a0, a1, seg = 18) {
    const T = this.THREE;
    // CylinderGeometry theta: x = sinθ, z = cosθ; after rotating X by -90°: (sinθ, cosθ) in XY → angle = 90° - θ
    const g = new T.CylinderGeometry(R, R, w, seg, 1, true, Math.PI / 2 - a1, a1 - a0);
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)), new T.Vector3(1, 1, 1));
    this.add(g, mat, color, L);
  }
  /** ellipsoid */
  blob(mat, color, cx, cy, cz, sx, sy, sz, rz = 0, ws = 14, hs = 10) {
    const T = this.THREE;
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(0, 0, rz)), new T.Vector3(sx, sy, sz));
    this.add(new T.SphereGeometry(1, this.low ? 8 : ws, this.low ? 5 : hs), mat, color, L);
  }

}

// ---------------------------------------------------------------------------
// Road dust collects along sills and tyres.
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function dusty(col, { dust = [0.42, 0.33, 0.24], top = 0.75, amt = 0.55 } = {}) {
  return (p) => {
    const d = (1 - sstep(0.12, top, p[1])) * amt;
    const c = col.map((v, i) => v * (1 - d) + dust[i] * d);


    return c;
  };
}



/** spoked wire wheel for motorbikes (axle along Z): tyre, chrome rim band, drum hub, crossed spokes */
function spokeWheel(k, cx, cy, R, w) {
  k.wheel(cx, cy, 0, R, w, [0.62, 0.63, 0.65], 22, false);
  const T = k.THREE;
  const ri = R * 0.64;
  k.cyl('chrome', [0.85, 0.85, 0.87], cx, cy, 0, ri * 0.98, ri * 0.98, w * 0.5, 'z', 22, true);
  k.cyl('steel', [0.55, 0.55, 0.56], cx, cy, 0, 0.065, 0.065, w * 0.9, 'z', 14);      // drum-brake hub
  for (let i = 0; i < (k.low ? 8 : 14); i++) {
    const a = (i / (k.low ? 8 : 14)) * Math.PI * 2, s = i % 2 ? 1 : -1;
    const b = a + 0.35 * s;
    k.rod('chrome', [0.8, 0.8, 0.82], [cx + Math.cos(b) * 0.05, cy + Math.sin(b) * 0.05, s * 0.035], [cx + Math.cos(a) * ri * 0.96, cy + Math.sin(a) * ri * 0.96, 0], 0.005, 3);
  }
  void T;
}

function motorbike(k, paint) {
  // 100–125 cc commuter motorcycle (generic): spoked wheels, teardrop tank with knee recesses,
  // rounded side covers, long flat seat, round headlamp with visor, telescopic fork,
  // chrome silencer with heat shield, front/rear fenders, grab rail, side stand.
  const T = k.THREE;
  const R = 0.3, xf = 1.27, D = [1, 1, 1];
  const smooth = (pts, n) => new T.SplineCurve(pts.map(([x, y]) => new T.Vector2(x, y))).getPoints(n).map((p) => [p.x, p.y]);
  const col = dusty(paint, { top: 0.5, amt: 0.3 });
  spokeWheel(k, 0, R, R, 0.1);
  spokeWheel(k, xf, R, R, 0.085);
  // ---- fenders (painted on rear, chrome-ish front)
  k.shell('paintSolid', col, 0, R, 0, R + 0.05, 0.13, Math.PI * 0.35, Math.PI * 1.05, 14);
  k.shell('paintSolid', col, xf, R, 0, R + 0.045, 0.11, -Math.PI * 0.02 + Math.PI * 0.2, Math.PI * 0.8, 14);
  // ---- frame: down tube, backbone, swing arm, rear shocks
  k.rod('dark', D, [1.08, 0.98, 0], [0.82, 0.42, 0], 0.024, 8);
  k.rod('dark', D, [1.08, 0.98, 0], [0.42, 0.82, 0], 0.022, 8);
  k.rod('dark', D, [0.42, 0.82, 0], [-0.12, 0.72, 0], 0.02, 6);
  for (const s of [-1, 1]) {
    k.rod('dark', D, [0.5, 0.42, s * 0.07], [0, R, s * 0.07], 0.02, 6);
    k.rod('chrome', [0.85, 0.85, 0.87], [0.02, R + 0.04, s * 0.09], [0.08, 0.76, s * 0.11], 0.016, 8);
    k.rod('dark', D, [0.045, R + 0.18, s * 0.09], [0.07, 0.66, s * 0.11], 0.026, 8);     // spring
    // front telescopic fork: chrome stanchion + painted lower leg
    k.rod('chrome', [0.9, 0.9, 0.92], [xf - 0.02, R + 0.18, s * 0.075], [1.1, 1.02, s * 0.075], 0.017, 8);
    k.rod('steel', [0.55, 0.55, 0.56], [xf, R, s * 0.075], [xf - 0.07, R + 0.3, s * 0.075], 0.024, 8);
    // footrests
    k.rod('dark', D, [0.5, 0.33, s * 0.1], [0.5, 0.33, s * 0.24], 0.012, 6);
  }
  // ---- engine: crankcase with round side covers, finned cylinder angled forward, carb
  k.blob('steel', [0.55, 0.55, 0.57], 0.56, 0.4, 0, 0.2, 0.13, 0.12, 0, 14, 10);
  k.cyl('steel', [0.68, 0.68, 0.7], 0.53, 0.38, 0.12, 0.1, 0.1, 0.03, 'z', 16);
  k.cyl('steel', [0.68, 0.68, 0.7], 0.6, 0.42, -0.12, 0.085, 0.085, 0.03, 'z', 16);
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    k.box('dark', [0.5, 0.5, 0.5], 0.73 + t * 0.09, 0.48 + t * 0.15, 0, 0.12, 0.012, 0.15, 0, 0, -0.55);
  }
  k.cyl('dark', D, 0.5, 0.58, 0.05, 0.035, 0.035, 0.08, 'z', 8);
  // ---- exhaust: header pipe + chrome silencer + black heat shield
  k.rod('chrome', [0.8, 0.8, 0.82], [0.86, 0.5, 0.06], [0.82, 0.28, 0.12], 0.018, 8);
  k.rod('chrome', [0.8, 0.8, 0.82], [0.82, 0.28, 0.12], [0.45, 0.27, 0.15], 0.018, 8);
  k.rod('chrome', [0.88, 0.88, 0.9], [0.45, 0.27, 0.15], [-0.25, 0.36, 0.16], 0.045, 12);
  k.cyl('dark', D, -0.26, 0.36, 0.16, 0.035, 0.035, 0.02, 'x', 10);
  k.rod('dark', D, [0.3, 0.3, 0.2], [0.0, 0.33, 0.2], 0.03, 8);
  // ---- fuel tank: side profile extruded with tumblehome + big bevel = teardrop with knee recess
  const tank = smooth([[0.62, 0.84], [0.7, 0.98], [0.86, 1.04], [1.02, 1.01], [1.09, 0.93], [1.04, 0.84], [0.85, 0.81], [0.62, 0.84]], 24);
  k.profile('paintSolid', col, tank, 0.26, { bevel: 0.06, taperY0: 0.88, taperY1: 1.06, taper: 0.62, curve: 4 });
  k.cyl('chrome', [0.8, 0.8, 0.82], 0.88, 1.065, 0, 0.03, 0.03, 0.012, 'y', 10);    // filler cap
  // ---- side covers (rounded triangles) under the seat
  const sc = smooth([[0.25, 0.58], [0.46, 0.58], [0.56, 0.74], [0.3, 0.8], [0.22, 0.7], [0.25, 0.58]], 14);
  k.profile('paintSolid', col, sc, 0.24, { bevel: 0.035, curve: 4 });
  // ---- seat: long, rounded, black vinyl
  const seat = smooth([[-0.12, 0.78], [0.62, 0.8], [0.66, 0.86], [0.5, 0.91], [0.1, 0.92], [-0.13, 0.88], [-0.12, 0.78]], 18);
  k.profile('dark', [0.45, 0.45, 0.45], seat, 0.25, { bevel: 0.05, taperY0: 0.85, taperY1: 0.93, taper: 0.8, curve: 4 });
  // grab rail, tail lamp, number plate
  k.arc('chrome', [0.7, 0.7, 0.72], -0.1, 0.84, 0, 0.13, 0.012, Math.PI * 0.5, Math.PI * 1.5, 10, 5, 1);
  k.blob('lights', [0.75, 0.06, 0.05], -0.2, 0.76, 0, 0.06, 0.035, 0.07, 0, 10, 6);
  k.box('lights', [0.92, 0.9, 0.82], -0.24, 0.62, 0, 0.012, 0.12, 0.18, 0, 0, 0.3);
  // ---- front: headlamp (round, chrome bezel), visor, speedo, handlebar, levers, mirrors, indicators
  k.cyl('chrome', [0.85, 0.85, 0.87], 1.17, 0.98, 0, 0.085, 0.075, 0.09, 'x', 18);
  k.cyl('lights', [1, 0.98, 0.9], 1.22, 0.98, 0, 0.074, 0.074, 0.012, 'x', 18);
  k.blob('paintSolid', col, 1.12, 1.07, 0, 0.1, 0.06, 0.12, 0.3, 12, 8);
  k.cyl('dark', D, 1.06, 1.12, 0, 0.05, 0.05, 0.05, 'y', 12);
  k.rod('chrome', [0.85, 0.85, 0.87], [1.03, 1.1, -0.33], [1.03, 1.1, 0.33], 0.011, 6);
  for (const s of [-1, 1]) {
    k.rod('chrome', [0.85, 0.85, 0.87], [1.03, 1.1, s * 0.33], [0.98, 1.13, s * 0.36], 0.011, 6);
    k.cyl('dark', D, 0.98, 1.135, s * 0.4, 0.016, 0.016, 0.1, 'z', 8);                   // grips
    k.rod('chrome', [0.8, 0.8, 0.82], [1.03, 1.11, s * 0.2], [1.0, 1.27, s * 0.27], 0.007, 4);
    k.cyl('dark', D, 1.0, 1.29, s * 0.27, 0.045, 0.045, 0.012, 'x', 12);                   // round mirror
    k.cyl('chrome', [0.6, 0.6, 0.62], 0.992, 1.29, s * 0.27, 0.04, 0.04, 0.004, 'x', 12);
    k.blob('lights', [1, 0.5, 0.08], 1.14, 0.98, s * 0.16, 0.035, 0.022, 0.022, 0, 8, 6);
    k.blob('lights', [1, 0.5, 0.08], -0.17, 0.8, s * 0.14, 0.03, 0.02, 0.02, 0, 8, 6);
  }
  // side stand (left side, -Z when leaning)
  k.rod('dark', D, [0.42, 0.36, -0.1], [0.36, 0.02, -0.3], 0.012, 6);
}


// Smooth cross-sections carry the shoulder, bonnet crown and wheel openings through each body.
function skin(k,material,color,rows) {
  const p=[],idx=[],stride=rows[0].length;
  rows.forEach((row,i)=>row.forEach((v,j)=>{
    p.push(...v);
    if(i&&j){const d=i*stride+j;idx.push(d-stride-1,d-1,d,d-stride-1,d,d-stride);}
  }));
  const g=new k.THREE.BufferGeometry();
  g.setAttribute('position',new k.THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();
  k.add(g,material,color);
}

function car(k,suv) {
  // assumed: sub-four-metre hatchbacks and compact crossovers, nose along local +X.
  const width=suv?1.80:1.72, w=width*.5, wheel=suv?.312:.300, rear=.67, front=3.15;
  const color=dusty([.90,.90,.90],{amt:.18,top:.65}),black=[.78,.79,.77], silver=[.50,.53,.55];
  const top=x=>x<.32?.92+x*.4:x<2.58?1.04+.018*Math.sin(x*1.27):1.05-.082*(x-2.58)-.051*(x-2.58)**2;
  const hw=x=>w*(1-.095*Math.exp(-x*4)-.16*Math.exp(-(3.94-x)*4.5));
  const sections=[];
  const stations=new Set([0,.06,.18,.33,1.22,1.37,1.85,2.35,2.60,3.48,3.66,3.79,3.89,3.94]);
  const arcSteps=k.low?8:12;
  for(const axle of [rear,front])for(let i=0;i<=arcSteps;i++)stations.add(axle+(wheel+.062)*Math.cos(i*Math.PI/arcSteps));
  for(const x of [...stations].sort((a,b)=>a-b)){
    const arch=Math.min(Math.abs(x-rear),Math.abs(x-front)), radius=wheel+.063;
    const bottom=arch<radius?wheel+Math.sqrt(Math.max(0,radius**2-arch**2)):.30;
    const h=top(x),r=hw(x);
    const flank=Math.max(bottom+.057,h*.72);
    const side=[[x,.28,0],[x,bottom,r*.925],[x,bottom+.038,r*.970],[x,flank,r*.995],
      [x,flank+.036,r*1.008],[x,h-.10,r],[x,h-.044,r*.966],[x,h-.015,r*.85],[x,h+.012,r*.64],[x,h+.032,0]];
    const other=side.slice(0,-1).reverse().map(([xx,yy,z])=>[xx,yy,-z]);
    sections.push([...side,...other].map(([xp,yp,zp])=>{
      const corner=Math.pow(Math.abs(zp/r),3);
      return [xp+corner*(.12*Math.exp(-xp*7)-.18*Math.exp(-(3.94-xp)*7)),yp,zp];
    }));
  }
  skin(k,'paint',color,sections);
  // Stitch the ends to the same cross-sections as the sides. The treatment
  // makes the shoulder roll into the tailgate without a crack in the sheet metal.
  const widthSteps=k.low?[-1,-.68,0,.68,1]:[-1,-.90,-.70,-.44,0,.44,.70,.90,1];
  for(const [section,x,sign] of [[sections[0],0,-1],[sections.at(-1),3.94,1]]){
    const rows=section.slice(0,(section.length+1)/2).map(([edgeX,y,half])=>{
      const bulge=.058*(1-.45*Math.min(1,Math.abs(y-.56)/.36));
      return widthSteps.map(u=>[x+(edgeX-x)*Math.abs(u)**3+sign*bulge*(1-u*u),y,half*u]);
    });
    if(sign<0)rows.reverse();
    skin(k,'paint',color,rows);
  }
  const height=suv?1.552:1.482,tail=suv?.35:.54,gw=w*.955;
  // Every column pairs a waist point with its cant-rail point. Glazing and
  // pillars share their edges even where the A and C pillars rake inwards.
  const columns=[
    [.10,tail,height-.046,.800],[.33,tail+.132,height,.778],
    [1.23,1.22,height+.029,.770],[1.31,1.30,height+.030,.770],
    [1.365,1.355,height+.030,.770],[2.63,1.90,height-.007,.793],
    [2.76,1.99,height-.025,.802]
  ];
  const belt=1.029, crown=.034;
  const waist=c=>gw*(.948+.052*Math.sin(Math.PI*(c[0]-.10)/2.66));
  const glassTint=p=>{
    const sky=sstep(belt,height,p[1]);
    return [.72+sky*.57,.76+sky*.58,.79+sky*.61];
  };
  function sidePoint(c,t,side){
    const [xb,xt,yt,zt]=c;
    return [xb+(xt-xb)*t,belt+(yt-belt)*t,
      side*(waist(c)*(1-t)+gw*zt*t+.012*Math.sin(Math.PI*t))];
  }
  const columnsAcross=k.low?[-1,-.72,0,.72,1]:[-1,-.92,-.66,-.34,0,.34,.66,.92,1];
  function screenPoint(c,t,u,sign){
    const v=sidePoint(c,t,1),centre=1-u*u;
    return [v[0]+sign*.046*(1-t)*centre,v[1]+crown*centre,v[2]*u];
  }
  const ends=[[columns[0],-1],[columns.at(-1),1]];
  for(const [c,sign] of ends){
    const portal=(t,u)=>screenPoint(c,t,u,sign);
    for(const [ta,tb,surface] of [[0,.045,'dark'],[.045,.95,'glass'],[.95,.97,'dark'],[.97,1,'paint']]){
      const levels=[ta,(ta+tb)/2,tb];
      skin(k,surface,surface==='paint'?color:surface==='glass'?glassTint:black,
        levels.map(t=>columnsAcross.map(u=>portal(t,u))));
    }
    // The hatch and the scuttle meet the painted shoulder under the screen.
    skin(k,'paint',color,[
      columnsAcross.map(u=>[c[0]+sign*.11,belt-.142+.039*(1-u*u),u*waist(c)*1.028]),
      columnsAcross.map(u=>portal(0,u))
    ]);
    if(sign<0){
      const a=portal(.15,-.085),b=portal(.21,.66);a[0]-=.008;b[0]-=.008;
      k.rod('dark',black,a,b,.010,6);
      const rows=[.928,.952].map(t=>[-.23,.23].map(u=>{const v=portal(t,u);v[0]-=.005;return v;}));
      skin(k,'lights',[.21,.012,.009],rows);
      if(!k.low)for(const t of [.32,.46,.60,.74]){
        skin(k,'glass',[1.31,1.26,1.19],[t,t+.0035].map(f=>[-.89,-.5,0,.5,.89].map(u=>{
          const v=portal(f,u);v[0]-=.004;return v;
        })));
      }
    }else for(const u of [-.55,.32]){
      const a=portal(.055,u-.22),b=portal(.101,u+.34);a[0]+=.007;b[0]+=.007;
      k.rod('dark',black,a,b,.009,5);
    }
  }
  const roof=columns.map(c=>columnsAcross.map(u=>screenPoint(c,1,u,1)));
  skin(k,'paint',color,roof);
  for(const s of [-1,1]) {
    for(let i=0;i<columns.length-1;i++){
      const edges=columns.slice(i,i+2);
      const solid=i===0 || i===3 || i===5, pillar=i===2;
      for(const [lo,hi,trim] of [[0,.034,true],[.034,.50,false],[.50,.966,false],[.966,1,true]]){
        const mat=solid?'paint':pillar||trim?'dark':'glass';
        skin(k,mat,mat==='paint'?color:mat==='glass'?glassTint:black,edges.map(c=>[sidePoint(c,lo,s),sidePoint(c,hi,s)]));
      }
      // The belt returns into the side stamping below the base of the glass.
      skin(k,'paint',color,edges.map(c=>[
        [c[0],top(c[0])-.10,s*hw(c[0])*.99],
        [c[0],belt-.025,s*(waist(c)+.015)],sidePoint(c,0,s)
      ]));
    }
    for(const x of [.94,2.07]) k.blob('paint',color,x,.93,s*hw(x)*1.001,.094,.022,.021,0,8,4);
    for(const x of [1.34,2.57]) {
      k.rod('dark',[.48,.48,.45],[x,.999,s*hw(x)*.987],[x-.025,.82,s*hw(x)*1.009],.006,4);
      k.rod('dark',[.48,.48,.45],[x-.025,.82,s*hw(x)*1.009],[x-.05,.40,s*hw(x)*.992],.006,4);
    }
    k.box('dark',black,1.90,.349,s*w*.979,1.66,.049,.038);
    k.rod('dark',black,[2.45,1.047,s*gw],[2.43,1.083,s*(w+.09)],.031,7);
    k.blob('paint',color,2.43,1.108,s*(w+.13),.119,.059,.081,-.06,12,7);
    k.blob('glass',[1,1,1],2.338,1.11,s*(w+.131),.019,.043,.056,0,10,5);
    for(const axle of [rear,front]) {
      const z=s*(w-.088), edge=z+s*.095;
      k.cyl('dark',[.25,.25,.25],axle,wheel+.027,z-s*.08,wheel*1.065,wheel*1.065,.06,'z',18);
      k.wheel(axle,wheel,z,wheel,.184,[.23,.25,.26]);
      k.cyl('steel',[.47,.47,.44],axle,wheel,edge,wheel*.54,wheel*.54,.012,'z',k.low?12:22);
      k.cyl('steel',silver,axle,wheel,edge+s*.010,wheel*.28,wheel*.28,.015,'z',12);
      if(!k.low)for(let j=0;j<8;j++){
        const a=j*Math.PI/4+.19;
        k.cyl('dark',black,axle+.119*Math.cos(a),wheel+.119*Math.sin(a),edge+s*.008,.017,.017,.004,'z',6);
      }
    }
    if(suv)k.rod('dark',black,[.57,height+.047,s*.49],[1.74,height+.057,s*.49],.023,6);
    // A wraparound lens follows the bumper into the front wing. Reflectors sit inside a graphite bezel.
    function lamp(a,b,inner,outer,thick,mat,col,offset,back=false){
      const xs=back?0:3.94,r=hw(xs),sign=back?-1:1;
      const rows=[];
      for(let j=0;j<7;j++){
        const f=j/6,t=a+(b-a)*f,yy=inner+(outer-inner)*f;
        const xx=xs+sign*(.055*(1-t*t)-(back?.12:.18)*Math.abs(t)**3+offset);
        const half=thick*(1-.62*f*f);
        rows.push([[xx,yy-half,s*r*t],[xx,yy+half,s*r*t]]);
      }
      if(s===sign)rows.reverse();
      skin(k,mat,col,rows);
    }
    lamp(.37,.985,.680,.734,.060,'dark',black,.014);
    lamp(.405,.967,.686,.739,.043,'lights',[.40,.45,.44],.019);
    lamp(.43,.94,.707,.747,.010,'lights',[.82,.85,.73],.022);
    lamp(.86,.95,.715,.729,.015,'lights',[.64,.237,.045],.026);
    lamp(.43,.998,.754,.840,.058,'dark',black,.018,true);
    lamp(.45,.993,.759,.843,.045,'lights',[.25,.012,.009],.023,true);
    lamp(.53,.983,.774,.848,.012,'lights',[.56,.028,.016],.027,true);
    lamp(.475,.69,.742,.775,.010,'lights',[.46,.41,.34],.028,true);
    const wrap=[[.095,.837,hw(0)*.99,.032],[.15,.835,hw(.15)*1.004,.046],
      [.24,.831,hw(.24)*1.008,.036],[.36,.841,hw(.36)*1.002,.012]];
    skin(k,'lights',[.29,.015,.010],wrap.map(([x,y,z,h])=>[[x,y-h,s*z],[x,y+h,s*z]]));
  }
  function intake(y,half,h,taper,offset,mat,col) {
    const r=hw(3.94);
    const edge=(u,v)=>{
      const z=u*half*(1-(1-v)*taper),t=z/r;
      const yy=y+(v-.5)*h*(1-.38*Math.abs(u)**4);
      const bulge=.058*(1-.45*Math.min(1,Math.abs(yy-.56)/.36));
      return [3.94-.18*Math.abs(t)**3+bulge*(1-t*t)+offset,yy,z];
    };
    skin(k,mat,col,widthSteps.map(u=>[edge(u,0),edge(u,1)]));
  }
  intake(.680,.348,.106,.16,.011,'dark',black);
  intake(.724,.337,.012,.02,.016,'steel',[.37,.38,.37]);
  intake(.431,.544,.143,.12,.011,'dark',black);
  for(const y of [.397,.438,.479])intake(y,.496,.010,.01,.017,'steel',[.17,.18,.17]);
  // A tucked lower valance, pressed hatch shutline and release above the plate.
  const fascia=(t,y)=>[-.058*(1-t*t)+.12*Math.abs(t)**3-.009,y,t*hw(0)];
  const span=[-.985,-.86,-.62,-.30,0,.30,.62,.86,.985];
  skin(k,'dark',black,span.map(t=>[fascia(t,.31),fascia(t,.364+.041*(1-t*t))]));
  skin(k,'dark',[.56,.55,.53],span.map(t=>[fascia(t,.486+.12*t*t),fascia(t,.494+.12*t*t)]));
  for(const side of [-1,1]){
    skin(k,'dark',black,[.68,.88,.94].map(t=>[fascia(t*side,.388),fascia(t*side,.418)]));
    skin(k,'lights',[.31,.013,.008],[.68,.86,.92].map(t=>{
      const lo=fascia(t*side,.393),hi=fascia(t*side,.413);lo[0]-=.003;hi[0]-=.003;return [lo,hi];
    }));
  }
  k.box('dark',black,-.063,.752,0,.018,.022,.204);


  for(const [x,y] of [[4.024,.539],[-.066,.651]]){
    k.box('dark',black,x,y,0,.015,.126,.482);
  }
  k.box('dark',[.41,.42,.41],1.88,.245,0,3.36,.115,width-.29);
  // The cabin behind the solar-control glass gives it depth at street level.
  k.box('dark',[.29,.30,.30],1.45,1.03,0,2.38,.075,1.37);
  k.box('dark',black,2.39,1.077,0,.45,.094,1.40,0,0,-.05);
  for(const x of [.88,1.69])for(const side of [-1,1]){
    const z=side*.36;
    if(k.low)k.box('dark',[.60,.63,.62],x,1.19,z,.13,.21,.22,0,0,-.1);
    else{
      k.blob('dark',[.60,.63,.62],x,1.092,z,.108,.151,.189,-.14,8,5);
      k.blob('dark',[.66,.69,.68],x-.035,1.25,z,.068,.081,.105,-.10,8,5);
    }
  }
}

// Fixed finishes share one batch; roughness and metalness are constant on each
// stamped panel, lens or tyre. Paint has its own instanced clear-coated material.
function finishMaterial(THREE) {
  const material=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide});
  material.onBeforeCompile=sh=>{
    sh.vertexShader='attribute vec2 finish; varying vec2 vFinish;\n'+sh.vertexShader
      .replace('#include <begin_vertex>','#include <begin_vertex>\n vFinish=finish;');
    sh.fragmentShader='varying vec2 vFinish;\n'+sh.fragmentShader
      .replace('#include <roughnessmap_fragment>','float roughnessFactor=vFinish.x;')
      .replace('#include <metalnessmap_fragment>','float metalnessFactor=vFinish.y;');
  };
  return material;
}

function fixedParts(kit) {
  const merged=new GeoBuilder(), finishes=[];
  const surfaces={
    paintSolid:[.30,.31,[1,1,1]],
    rubber:[.91,.00,[.024,.025,.024]], steel:[.36,.64,[1,1,1]],
    dark:[.57,.06,[.036,.036,.034]], lights:[.20,.17,[1,1,1]], chrome:[.25,.79,[1,1,1]]
  };
  for(const [name,[roughness,metalness,tint]] of Object.entries(surfaces)){
    const part=kit.gb[name], first=merged.count;
    // Avoid large spreads for the merged motorcycle geometry on mobile browsers.
    for(let i=0;i<part.count;i++){
      const j=i*3, c=tint.map((v,ch)=>v*part.c[j+ch]);
      merged.vert(part.p.slice(j,j+3),part.n.slice(j,j+3),part.uv.slice(i*2,i*2+2),c);
      finishes.push(roughness,metalness);
    }
    for(const index of part.i)merged.i.push(first+index);
  }
  const geo=merged.build(kit.THREE,{color:true});
  geo.setAttribute('finish',new kit.THREE.Float32BufferAttribute(finishes,2));
  return geo;
}

function registrationPlates(THREE,cars) {
  const rowH=36,canvas=makeCanvas(160,rowH*cars.length),g=canvas.getContext('2d');
  const gb=new GeoBuilder(),pose=new THREE.Object3D(),point=new THREE.Vector3();
  const series=['KC','GA','FA','HD','JT','BL','GD','EK']; // assumed, illustrative registrations
  g.textAlign='center';g.textBaseline='middle';g.font='bold 23px Arial';
  cars.forEach(({x,y,angle,road},i)=>{
    g.fillStyle='#dddcd0';g.fillRect(0,i*rowH,canvas.width,rowH);
    g.fillStyle='#373833';g.fillText('TS 08 '+series[i%series.length]+' '+(3247+(i*793)%6320),80,(i+.52)*rowH,149);
    pose.position.set(x,road?.024:.002,-y);pose.rotation.y=(90-angle)*Math.PI/180;
    pose.translateX(-1.97);pose.updateMatrix();
    for(const [cx,cy,sign] of [[4.034,.539,1],[-.076,.651,-1]]){
      const normal=new THREE.Vector3(sign,0,0).applyQuaternion(pose.quaternion).toArray();
      const corners=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>{
        point.set(cx,cy+(v-.5)*.108,sign*(.5-u)*.464).applyMatrix4(pose.matrix);
        return gb.vert(point.toArray(),normal,[u,(cars.length-i-1+v)/cars.length]);
      });
      gb.quad(...corners);
    }
  });
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;completeMips(map);
  const mesh=new THREE.Mesh(gb.build(THREE),new THREE.MeshStandardMaterial({map,roughness:.43}));
  mesh.name='Vehicle registration plates';mesh.receiveShadow=true;return mesh;
}

export function buildVehicles(ctx,parent) {
  const {THREE,site}=ctx,low=ctx.quality==='low';
  const locations=vehicles(site),contacts=[];
  const paints=[0xe9e7de,0xb9bebd,0xd9dbd9,0x535a5c,0xebe8da,0x843c35,0x35465b,0xc4c7c4];
  const paint=new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.32,metalness:.29,
    clearcoat:.52,clearcoatRoughness:.21,side:THREE.DoubleSide});
  const glazing=new THREE.MeshPhysicalMaterial({color:0x38494d,vertexColors:true,roughness:.17,metalness:.12,
    clearcoat:.35,clearcoatRoughness:.14,transparent:true,opacity:.84,depthWrite:false,
    side:THREE.DoubleSide,forceSinglePass:true});
  const finish=finishMaterial(THREE),pose=new THREE.Object3D();
  const cars=locations.cars.map(([x,y,angle],i)=>({
    x,y,angle,suv:i%3===1,color:paints[i%paints.length],road:Math.abs(x-roadAt(site,y))<site.ROAD.width/2
  })).filter((_,i)=>!low || i%4!==2);
  if(cars.length)parent.add(registrationPlates(THREE,cars));
  for(const suv of [false,true]){
    const sites=cars.filter(c=>c.suv===suv);
    if(!sites.length)continue;
    const k=new Kit(THREE,low);
    car(k,suv);
    const body=new THREE.InstancedMesh(k.gb.paint.build(THREE,{color:true}),paint,sites.length);
    const trim=new THREE.InstancedMesh(fixedParts(k),finish,sites.length);
    const windows=new THREE.InstancedMesh(k.gb.glass.build(THREE,{color:true}),glazing,sites.length);
    body.name=(suv?'Compact SUV':'Hatchback')+' - clear-coated bodywork';
    trim.name=(suv?'Compact SUV':'Hatchback')+' - trim and wheels';
    windows.name=(suv?'Compact SUV':'Hatchback')+' - smoked glazing';
    sites.forEach(({x,y,angle,color,road},i)=>{
      const z=road?.024:.002;
      pose.position.set(x,z,-y);pose.rotation.y=(90-angle)*Math.PI/180;
      pose.translateX(-1.97);pose.updateMatrix();
      body.setMatrixAt(i,pose.matrix);trim.setMatrixAt(i,pose.matrix);windows.setMatrixAt(i,pose.matrix);
      body.setColorAt(i,new THREE.Color(color));
      contacts.push([x,y,z,angle,4.1,1.82]);
    });
    for(const mesh of [body,trim,windows]){
      mesh.castShadow=mesh!==windows;mesh.receiveShadow=true;
      mesh.computeBoundingSphere();parent.add(mesh);
    }
  }
  const bikes=new Kit(THREE,low);
  locations.bikes.slice(0,low?2:3).forEach(([x,y,angle],i)=>{
    bikes.begin(x,y,angle,-.105);
    contacts.push([x,y,.002,angle,1.68,.51]);
    bikes.M.multiply(new THREE.Matrix4().makeTranslation(-.65,.005,0));
    motorbike(bikes,[[.18,.035,.022],[.017,.023,.027],[.03,.072,.106]][i]);
  });
  const bikeMesh=new THREE.Mesh(fixedParts(bikes),finish);
  bikeMesh.name='Parked commuter motorcycles';bikeMesh.castShadow=bikeMesh.receiveShadow=true;parent.add(bikeMesh);
  const contactMat=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,
    vertexShader:'varying vec2 p;void main(){p=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec2 p;void main(){vec2 d=abs(p);float a=(1.-smoothstep(.59,1.,d.x))*(1.-smoothstep(.48,1.,d.y));gl_FragColor=vec4(.067,.058,.048,.46*a);}'
  });
  const contactGeo=new THREE.PlaneGeometry(1,1);contactGeo.rotateX(-Math.PI/2);
  const contact=new THREE.InstancedMesh(contactGeo,contactMat,contacts.length), stamp=new THREE.Object3D();
  contacts.forEach(([x,y,z,angle,length,width],i)=>{
    stamp.position.set(x,z+.002,-y);stamp.rotation.y=(90-angle)*Math.PI/180;
    stamp.scale.set(length*1.18,1,width*1.32);stamp.updateMatrix();contact.setMatrixAt(i,stamp.matrix);
  });
  contact.name='Vehicle contact shadows';contact.renderOrder=-.5;parent.add(contact);
}
