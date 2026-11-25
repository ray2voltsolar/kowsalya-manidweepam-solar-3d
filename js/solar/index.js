// Instanced glass-glass modules, independent terrace tables and electrical overlays.
// Solar round 2 · project scratchpad
// Goal: glass, cell interconnects and terrace fixings that hold up in proposal close-ups.
// Basis: use the active site layout and module envelope. Extrusions, fixings, rubber pads
// and bond routes are assumed details for the proposal, subject to the supplier's drawings.
// Decisions: share a metric wafer pattern across both faces, compress only reflected light,
// and apply the survey palette after lighting. Batch the supports independently of picking.
// Integrated review views: _work/shots/solar2/ (15 Feb 2026, 15:30 IST).
import { laminateGeometry, frameGeometry, backDetailGeometry } from './module.js';
import { makeCellTexture, makeBackTexture, rng } from './textures.js';
import { W, WD } from './geom.js';
import { buildStructure } from './structure.js';
import { buildBOS } from './bos.js';
import { buildInverterStations } from './inverter.js';

export async function buildSolar(ctx) {
  const { THREE, site } = ctx;
  const Q = ctx.quality || 'high';
  const MOD = site.MODULE;
  const modules = site.computeLayout();
  const N = modules.length;
  const group = new THREE.Group(); group.name = 'solar';
  const aniso = Math.min(ctx.maxAnisotropy || 1, 16);

  // ---------------------------------------------------------------- materials
  const texH = Q === 'low' ? 512 : Q === 'medium' ? 1536 : 4096;
  const cellMap = makeCellTexture(texH, aniso, MOD);
  const backMap = makeBackTexture(Math.max(256, texH / 2), aniso, MOD);

  // Render the laminate after opaque roof/steel with normal depth writes. Only the
  // clear encapsulant blends. The complete panel still enters the sky-occlusion pass.
  const glassBlend = {
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  };
  const glassMat = new THREE.MeshPhysicalMaterial({
    ...glassBlend, name: 'pv-glass', map: cellMap, color: 0xffffff, roughness: 0.34, metalness: 0,
    clearcoat: 0.68, clearcoatRoughness: 0.14, envMapIntensity: 0.77,
    specularIntensity: 0.34, ior: 1.37,
  });
  const uStrings = { value: 0 };
  // Mipmap filtering integrates the narrow lanes into neighbouring opaque
  // cells. Fresnel reduces their transmission at grazing incidence.
  const glassCoverage = `
    float pvFacing = abs(dot(normalize(vNormal),normalize(vViewPosition)));
    float pvCoverage = 1.0 - (1.0-diffuseColor.a) * (0.76 - 0.50*pow(1.0-pvFacing,5.0));
  `;
  glassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uStrings = uStrings;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aTint;
attribute vec4 aStringEdges;
attribute vec4 aVar;
varying vec4 vTint;
varying vec4 vStringEdges;
varying vec2 vVar;
varying vec3 vPvU;
varying vec3 vPvV;`)
      // per-module mounting tolerance: ±0.2° tilt scatter → module-to-module reflection variation (as in drone photos)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = normalize(objectNormal + vec3(aVar.z, 0.0, aVar.w) * objectNormal.y);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTint = aTint; vVar = aVar.xy; vStringEdges = aStringEdges;
        // module in-plane axes in view space (for the glass-bow normal perturbation in the fragment shader)
        vPvU = normalize((modelViewMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vPvV = normalize((modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vTint;
varying vec4 vStringEdges;
varying vec2 vVar;
varying vec3 vPvU;
varying vec3 vPvV;
uniform float uStrings;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${glassCoverage}
        // A narrow dust deposit collects at the low gasket. Preserve the dark AR
        // coating at normal incidence and let the sky supply its angular colour.
        float pvDust = vVar.x * (1.0 - smoothstep(0.003, 0.020, vMapUv.y));
        diffuseColor.rgb = mix(diffuseColor.rgb * vVar.y, vec3(0.064,0.053,0.040), pvDust*0.18);
        vec3 pvOverlay = vTint.rgb;
        if (uStrings > 0.5) {
          vec4 edges = vec4(vMapUv, 1.0-vMapUv) * vec4(${MOD.width},${MOD.length},${MOD.width},${MOD.length});
          vec4 px = max(fwidth(edges),vec4(1e-5));
          vec4 strips = clamp((edges-0.014)/px+0.5,0.0,1.0) - clamp((edges-0.045)/px+0.5,0.0,1.0);
          pvOverlay = mix(pvOverlay,vec3(0.91),clamp(dot(strips,vStringEdges),0.0,1.0));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.85, pvDust * 0.6);`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
        // glass-glass laminate bow (~±0.35° at the edges) + mild cell-level waviness: the reflection of the sky /
        // sun sweeps across a module instead of lighting the whole module uniformly
        {
          vec2 pvC = vMapUv - 0.5;
          clearcoatNormal = normalize(clearcoatNormal + (vPvU * pvC.x * 2.0 + vPvV * pvC.y * 2.0) * 0.006
            + (vPvU * sin(vMapUv.y * 138.0) + vPvV * sin(vMapUv.x * 37.7)) * 0.0012);
        }`)
      .replace('#include <opaque_fragment>', `
        // Soft shoulder on reflected radiance only. Sun colour and the Fresnel
        // rise survive the compression, including in direct afternoon glare.
        vec3 pvBase = totalDiffuse * (1.0 - material.clearcoat * Fcc);
        vec3 pvReflection = max(outgoingLight - pvBase, vec3(0.0));
        float pvPeak = max3(pvReflection);
        outgoingLight = pvBase + pvReflection / (1.0 + pvPeak / 0.37);
        #include <opaque_fragment>
        gl_FragColor.a = mix(pvCoverage, 1.0, vTint.w);`)
      .replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>
        // Survey palettes are display colours. Apply after exposure, before sRGB encoding.
        gl_FragColor.rgb = mix(gl_FragColor.rgb, pvOverlay, vTint.w);`);
  };
  glassMat.customProgramCacheKey = () => 'pv-glass-' + MOD.key;
  const backMat = new THREE.MeshStandardMaterial({ ...glassBlend, name: 'pv-back', map: backMap, roughness: 0.42, metalness: 0, envMapIntensity: 0.48 });
  backMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + glassCoverage)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.a = pvCoverage;');
  };
  backMat.customProgramCacheKey = () => 'pv-rear-' + MOD.key;
  const frameMat = new THREE.MeshStandardMaterial({ name: 'pv-frame', color: new THREE.Color(MOD.frame.color), metalness: 0.8, roughness: 0.38, envMapIntensity: 0.85 });
  const blackMat = new THREE.MeshStandardMaterial({ name: 'pv-black', color: 0x141414, roughness: 0.6, metalness: 0.0 });
  // ---------------------------------------------------------------- modules
  const lamGeo = laminateGeometry(MOD);
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const R = rng(42);
  const varArr = new Float32Array(N * 4);
  const tilt = 0.0035; // rad (≈0.2°)
  for (let i = 0; i < N; i++) {
    varArr[i * 4] = 0.35 + R() * 0.45; varArr[i * 4 + 1] = 0.93 + R() * 0.12;
    varArr[i * 4 + 2] = (R() - 0.5) * 2 * tilt; varArr[i * 4 + 3] = (R() - 0.5) * 2 * tilt;
  }
  const aVar = new THREE.InstancedBufferAttribute(varArr, 4);
  lamGeo.setAttribute('aTint', aTint); lamGeo.setAttribute('aVar', aVar);

  const gridKey = (t,r,c) => t + '/' + r + '/' + c;
  const stringsAt = new Map(modules.map(m => [gridKey(m.table,m.row,m.col),m.stringIndex]));
  const edges = new Float32Array(N*4);
  for (const m of modules) {
    const border = (dr,dc) => Number(stringsAt.get(gridKey(m.table,m.row+dr,m.col+dc)) !== m.stringIndex);
    edges.set([border(0,-1),border(-1,0),border(0,1),border(1,0)],m.index*4);
  }
  lamGeo.setAttribute('aStringEdges',new THREE.InstancedBufferAttribute(edges,4));
  const moduleMesh = new THREE.InstancedMesh(lamGeo, [glassMat, backMat], N);
  moduleMesh.name = 'pv-modules';
  moduleMesh.renderOrder = 1;
  const frameMesh = new THREE.InstancedMesh(frameGeometry(MOD, Q), frameMat, N); frameMesh.name = 'pv-frames';
  const backMesh = new THREE.InstancedMesh(backDetailGeometry(MOD, Q), blackMat, N);

  const mtx = new THREE.Matrix4();
  modules.forEach((m, i) => {
    const U = WD(m.u), Nn = WD(m.n), V = WD(m.v).negate();
    mtx.makeBasis(U, Nn, V).setPosition(W(m.center));
    moduleMesh.setMatrixAt(i, mtx); frameMesh.setMatrixAt(i, mtx); backMesh.setMatrixAt(i, mtx);
  });
  for (const im of [moduleMesh, frameMesh, backMesh]) {
    im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingBox(); im.computeBoundingSphere();
    group.add(im);
  }
  backMesh.castShadow = false; backMesh.name = 'pv-junction-boxes-and-leads';
  moduleMesh.userData.occluderCategory = 'solar';
  ctx.registerOccluder && ctx.registerOccluder(moduleMesh);

  const structure = buildStructure(ctx);
  group.add(structure.group);
  const parts = { frameMesh, structure, bos: null, inverter: null };
  try {
    const bos = buildBOS(ctx, modules);
    group.add(bos.group);
    parts.bos = bos;
  } catch (error) { console.warn('Solar cable equipment unavailable', error); }
  try {
    const inv = buildInverterStations(ctx);
    group.add(inv.group);
    parts.inverter = inv;
  } catch (error) { console.warn('Solar inverter stations unavailable', error); }

  const STR_PAL = site.STRING_COLORS;
  // Both overlays share module-local coordinates measured from the SW glass corner.
  function surfacePoint(m, u, v, offset) {
    return W(m.corners[0]).addScaledVector(WD(m.u),u).addScaledVector(WD(m.v),v).addScaledVector(WD(m.n),offset);
  }
  const LBL_K = 0.018, LBL_MIN = 0.8, LBL_MAX = 2.6;   // label half-width = clamp(depth·K, MIN, MAX) metres
  const stringsOverlay = buildStringsOverlay();
  function buildStringsOverlay() {
    const g = new THREE.Group(); g.name = 'pv-strings-overlay'; g.visible = false;
    // labels: one atlas + one billboard mesh (single draw call), size grows with distance (clamped)
    const ids = [...new Set(modules.map((m) => m.stringIndex))].sort((a, b) => a - b);
    const cols = 4, cw = 256, ch = 128, rows = Math.ceil(ids.length / cols);
    const cv = document.createElement('canvas'); cv.width = cols * cw; cv.height = rows * ch;
    const c2 = cv.getContext('2d');
    ids.forEach((s, k) => {
      const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
      const colr = STR_PAL[s % STR_PAL.length];
      c2.fillStyle = 'rgba(16,20,26,0.82)'; rr(c2, x + 8, y + 14, cw - 16, ch - 28, 26); c2.fill();
      c2.lineWidth = 7; c2.strokeStyle = colr; rr(c2, x + 8, y + 14, cw - 16, ch - 28, 26); c2.stroke();
      c2.fillStyle = '#ffffff'; c2.font = 'bold 60px Arial, Helvetica, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText(`S${String(s + 1).padStart(2, '0')}`, x + cw / 2, y + ch / 2 - 9);
      const inv = (modules.find((m) => m.stringIndex === s) || {}).inverter || '';
      c2.fillStyle = 'rgba(255,255,255,0.78)'; c2.font = 'bold 24px Arial, Helvetica, sans-serif';
      c2.fillText(inv, x + cw / 2, y + ch / 2 + 32);
    });
    function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    const atlas = new THREE.CanvasTexture(cv); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = aniso;
    const cen = [], crn = [], uvs = [], anchors = [];
    ids.forEach((s, k) => {
      const ms = modules.filter((m) => m.stringIndex === s);
      const c = new THREE.Vector3(); ms.forEach((m) => c.add(W(m.center))); c.divideScalar(ms.length);
      // A string may span a duct. Keep the ID on its nearest actual module.
      const nearest = ms.reduce((best,m) => W(m.center).distanceToSquared(c) < W(best.center).distanceToSquared(c) ? m : best);
      c.copy(W(nearest.center)).addScaledVector(WD(nearest.n),0.35);
      const u0 = (k % cols) / cols, u1 = u0 + 1 / cols, v1 = 1 - Math.floor(k / cols) / rows, v0 = v1 - 1 / rows;
      const C4 = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, -1, u0, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
      for (const [x, y, u, v] of C4) { cen.push(c.x, c.y, c.z); crn.push(x, y * 0.5); uvs.push(u, v); }
      anchors.push(c.clone());
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(cen, 3));
    lg.setAttribute('corner', new THREE.Float32BufferAttribute(crn, 2));
    const offAttr = new THREE.Float32BufferAttribute(new Float32Array(crn.length), 2); offAttr.setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('offs', offAttr);
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    lg.computeBoundingSphere();
    const lm = new THREE.ShaderMaterial({
      name: 'pv-string-labels', transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      uniforms: { map: { value: atlas } },
      // offs = screen-space de-collision offset (view-space metres) computed on the CPU in onBeforeRender
      vertexShader: `attribute vec2 corner; attribute vec2 offs; varying vec2 vUv;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float s = clamp(-mv.z * ${LBL_K.toFixed(4)}, ${LBL_MIN.toFixed(2)}, ${LBL_MAX.toFixed(2)}); mv.xy += corner * s + offs; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main() { vec4 c = texture2D(map, vUv); if (c.a < 0.02) discard; gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
    });
    const labels = new THREE.Mesh(lg, lm); labels.name = 'pv-string-labels'; labels.renderOrder = 10; labels.frustumCulled = false; labels.raycast = () => {};
    // simple label de-collision: project the anchors, push overlapping label boxes apart (a few relaxation
    // passes, mostly vertically since labels are wide), write the result back as view-space offsets
    const nL = anchors.length, mvP = new THREE.Vector3(), sc = new Float32Array(nL * 4), dl = new Float32Array(nL * 2);
    labels.onBeforeRender = (renderer, scene, camera) => {
      if (!g.visible) return;
      const ortho = !!camera.isOrthographicCamera;
      for (let k = 0; k < nL; k++) {
        mvP.copy(anchors[k]).applyMatrix4(labels.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        const dz = Math.max(0.1, -mvP.z), s = Math.min(LBL_MAX, Math.max(LBL_MIN, dz * LBL_K)), f = ortho ? 1 : 1 / dz;
        sc[k * 4] = mvP.x * f; sc[k * 4 + 1] = mvP.y * f; sc[k * 4 + 2] = s * f; sc[k * 4 + 3] = f;   // centre, half-width, scale
        dl[k * 2] = 0; dl[k * 2 + 1] = 0;
      }
      for (let it = 0; it < 12; it++) {
        let moved = false;
        for (let a = 0; a < nL; a++) for (let b = a + 1; b < nL; b++) {
          const ax = sc[a * 4] + dl[a * 2], ay = sc[a * 4 + 1] + dl[a * 2 + 1], bx = sc[b * 4] + dl[b * 2], by = sc[b * 4 + 1] + dl[b * 2 + 1];
          const hw = (sc[a * 4 + 2] + sc[b * 4 + 2]) * 1.02, hh = (sc[a * 4 + 2] + sc[b * 4 + 2]) * 0.52;
          const ox = hw - Math.abs(ax - bx), oy = hh - Math.abs(ay - by);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (oy <= ox * 1.6) { const d = oy * 0.5 * (ay >= by ? 1 : -1); dl[a * 2 + 1] += d; dl[b * 2 + 1] -= d; }
          else { const d = ox * 0.5 * (ax >= bx ? 1 : -1); dl[a * 2] += d; dl[b * 2] -= d; }
        }
        if (!moved) break;
      }
      const o = offAttr.array;
      for (let k = 0; k < nL; k++) {
        const f = sc[k * 4 + 3], x = dl[k * 2] / f, y = dl[k * 2 + 1] / f;
        for (let v = 0; v < 6; v++) { o[(k * 6 + v) * 2] = x; o[(k * 6 + v) * 2 + 1] = y; }
      }
      offAttr.needsUpdate = true;
    };
    g.add(labels);
    group.add(g);
    return g;
  }

  // ---------------------------------------------------------------- colour modes
  const baseTint = new Float32Array(N * 4);
  let hl = null;
  const col = new THREE.Color();
  const writeTint = () => {
    const a = aTint.array; a.set(baseTint);
    if (hl !== null && hl >= 0 && hl < N) {
      const o = hl * 4; a[o] = 0.35; a[o + 1] = 0.85; a[o + 2] = 1.0; a[o + 3] = 0.7;
    }
    aTint.needsUpdate = true;
  };
  // ---------------------------------------------------------------- heat map helpers
  const HEAT_STEPS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75, 1.0];
  let heatScale = 1, worstList = [];
  // 5-stop ramp (sRGB): 0 green · 0.25 yellow-green · 0.5 yellow · 0.75 orange · 1 red
  const HEAT_RAMP = [[0.13, 0.66, 0.29], [0.62, 0.80, 0.16], [1.0, 0.84, 0.10], [1.0, 0.50, 0.06], [0.88, 0.10, 0.12]];
  function heatColor(t, out) {
    const x = Math.max(0, Math.min(1, t)) * 4, k = Math.min(3, Math.floor(x)), f = x - k;
    const a = HEAT_RAMP[k], b = HEAT_RAMP[k + 1];
    return out.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, THREE.SRGBColorSpace);
  }
  // worst-module markers: bright outline rings around the N most-shaded modules (one pre-allocated mesh)
  const WORST_N = 8;
  const worstRings = (() => {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(WORST_N * 4 * 6 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({ name: 'pv-worst-ring', color: 0xffffff, side: THREE.DoubleSide, toneMapped: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'pv-worst-rings'; mesh.visible = false; mesh.frustumCulled = false; mesh.raycast = () => {};
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 2;
    group.add(mesh);
    mesh.userData.write = (list) => {
      let n = 0;
      const put = (p) => { p.toArray(arr, n * 3); n++; };
      for (const i of list) {
        const m = modules[i];
        const P = (u,v) => surfacePoint(m,u,v,0.008);
        const e = 0.02, w = 0.09;     // ring sits just over the frame, 90 mm wide
        const quad = (u0, v0, u1, v1) => { const a = P(u0, v0), b = P(u1, v0), c = P(u1, v1), d = P(u0, v1); put(a); put(b); put(c); put(a); put(c); put(d); };
        quad(-e, -e, -e + w, MOD.length + e); quad(MOD.width + e - w, -e, MOD.width + e, MOD.length + e);
        quad(-e, -e, MOD.width + e, -e + w); quad(-e, MOD.length + e - w, MOD.width + e, MOD.length + e);
      }
      geo.attributes.position.needsUpdate = true; geo.setDrawRange(0, n);
      geo.computeBoundingSphere();
    };
    return mesh;
  })();
  function updateWorstRings(values, vmax) {
    worstList = [];
    if (values && vmax > 0.005) {
      const idx = [...Array(N).keys()].filter((i) => (+values[i] || 0) >= Math.max(0.005, vmax * 0.5));
      idx.sort((a, b) => (+values[b] || 0) - (+values[a] || 0));
      worstList = idx.slice(0, WORST_N);
    }
    worstRings.userData.write(worstList);
    worstRings.visible = worstList.length > 0;
  }

  let mode = 'normal';
  function setColorMode(m, values) {
    mode = m || 'normal';
    stringsOverlay.visible = mode === 'strings';
    uStrings.value = stringsOverlay.visible ? 1 : 0;
    if (mode !== 'heatmap') worstRings.visible = false;
    baseTint.fill(0);
    if (mode === 'strings' || mode === 'inverters') {
      for (let i = 0; i < N; i++) {
        const m = modules[i];
        col.set(mode === 'strings' ? STR_PAL[m.stringIndex % STR_PAL.length] : site.INVERTER_COLORS[m.inverter]);
        baseTint.set([col.r, col.g, col.b, 1], i * 4);
      }
    } else if (mode === 'heatmap') {
      // auto-range: the colour scale spans 0 … a "nice" ceiling of this run's worst module (5 %, 10 %, 15 %, 20 %,
      // 25 %, 30 %, 40 %, 50 %, 75 %, 100 %), so a run whose worst module is 20 % uses the whole green→red ramp
      let vmax = 0;
      for (let i = 0; i < N; i++) { const v = values ? +values[i] || 0 : 0; if (v > vmax) vmax = v; }
      heatScale = HEAT_STEPS.find((s) => s >= vmax - 1e-6) || 1;
      for (let i = 0; i < N; i++) {
        const t = Math.max(0, Math.min(1, (values ? +values[i] || 0 : 0) / heatScale));
        heatColor(t, col);
        baseTint.set([col.r, col.g, col.b, 1], i * 4);
      }
      updateWorstRings(values, vmax);
      try {
        window.dispatchEvent(new CustomEvent('pv-heatscale', { detail: { max: heatScale, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => f * heatScale), worst: worstList } }));
      } catch (e) { /* no window (tests) */ }
    }
    writeTint();
  }
  function highlight(index) {
    hl = (index === null || index === undefined || index < 0) ? null : index;
    writeTint();
  }
  function pick(raycaster) {
    if (!group.visible) return null;
    const hits = raycaster.intersectObject(moduleMesh, false);
    return hits.length && hits[0].instanceId !== undefined ? hits[0].instanceId : null;
  }
  function info(index) {
    const m = modules[index]; if (!m) return null;
    const { id, string, inverter, plane, block, table, array, azimuthDeg, tiltDeg, wp, row, col } = m;
    return { id, string, inverter, plane, block, table, array, azimuthDeg, tiltDeg, wp, row, col,
      roof: site.BLOCKS[block].name, building: block };
  }
  function setVisible(v) { group.visible = !!v; }
  setColorMode('normal');

  group.userData.solarApi = { setColorMode, highlight, worstModules: () => worstList.slice(), get heatScale() { return heatScale; } };
  return {
    group, modules, moduleMesh, setColorMode, setVisible, highlight, pick, info, parts,
    // heat-map scale for the legend: colour ramp spans 0 … heatScale (fraction shaded); legend ticks = heatTicks()
    get heatScale() { return heatScale; },
    heatTicks: () => [0, 0.25, 0.5, 0.75, 1].map((f) => f * heatScale),
    heatColorCss: (t) => '#' + heatColor(t, new THREE.Color()).getHexString(THREE.SRGBColorSpace),
    worstModules: () => worstList.slice(),
    stringColors: () => STR_PAL.slice(),
  };
}
