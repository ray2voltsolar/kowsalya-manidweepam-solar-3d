// ============================================================================
//  Sky, sun, moonlight, hemisphere fill, haze and the PMREM environment map.
//  Driven by the real sun position (js/analysis/sun.js) for the site.
// ============================================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

import { SITE, ROOF, OBSTACLES } from '../site-data.js';
import { QUALITY } from './renderer.js';

const roofTop = Math.max(...OBSTACLES.map(o => o.zTop)) + 3; // assumed allowance for tanks
const shadowHull = ROOF.polygons.flatMap(p => p.outer.flatMap(([x,y]) =>
  [new THREE.Vector3(x, 0, -y), new THREE.Vector3(x, roofTop, -y)]));

export class Lighting {
  constructor({ renderer, scene, quality }) {
    this.renderer = renderer; this.scene = scene;
    this.center = new THREE.Vector3(SITE.center.x, 0, -SITE.center.y);

    // --- Sky dome (visible background)
    const sky = new Sky();
    sky.scale.setScalar(4500);
    sky.name = 'sky';
    sky.userData.noPick = true;
    sky.frustumCulled = false;
    const u = sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 1.45;
    u.mieCoefficient.value = 0.0055;
    u.mieDirectionalG.value = 0.82;
    scene.add(sky);
    this.sky = sky;

    // --- Env scene for PMREM: sky + a ground disc that provides warm ground bounce
    this.envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(sky.geometry, sky.material);
    envSky.scale.setScalar(800);
    this.envScene.add(envSky);
    this.envGroundMat = new THREE.MeshBasicMaterial({ color: 0x40382e, side: THREE.DoubleSide, toneMapped: false });
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(400, 48), this.envGroundMat);
    envGround.rotation.x = -Math.PI / 2; envGround.position.y = -2;
    this.envScene.add(envGround);
    this.revision = 0;
    this.pmrem = null;
    this.quality = quality;
    this.hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.envRT = null;
    this._lastEnvDir = new THREE.Vector3(0, -1, 0);
    this._lastEnvTime = -1e9;
    this._envPending = false;

    // Tiny render target to read the true sky colour at the horizon (→ fog colour)
    this.horizonRT = new THREE.WebGLRenderTarget(16, 4, { type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.UnsignedByteType, depthBuffer: false });
    this.horizonCam = new THREE.PerspectiveCamera(20, 1, 0.1, 2000);
    this._px = this.horizonRT.texture.type === THREE.FloatType ? new Float32Array(64) : new Uint8Array(64); // one row across all four views

    // --- Sun (also used as moonlight at night)
    const sun = new THREE.DirectionalLight(0xffffff, 4);
    sun.castShadow = true;
    sun.shadow.camera.up.set(0, 0, -1); // north-up: avoids lookAt degeneracy with the sun at the zenith
    sun.shadow.normalBias = 0.012;
    sun.target.position.copy(this.center);
    scene.add(sun, sun.target);
    this.sun = sun;
    this._lightDir = new THREE.Vector3();
    this.setShadowMapSize(QUALITY[quality].shadow);

    // --- Hemisphere fill
    this.hemi = new THREE.HemisphereLight(0xbfd6f2, 0x8a7559, 0.6);
    scene.add(this.hemi);

    // --- Haze
    this.fogDensity = 0.00072;
    scene.fog = new THREE.FogExp2(0xc4d0dc, this.fogDensity);

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.elevation = 45; this.azimuth = 180;
    this.exposureDay = 0.5;
    this.night = 0; this.dusk = 0; this.lightsOn = 0; this._fogDim = 1;
  }

  setShadowMapSize(n) {
    this.shadowMargin = n >= QUALITY.high.shadow ? 70 : 0;
    n = Math.min(n, this.renderer.capabilities.maxTextureSize);
    const s = this.sun.shadow;
    if (s.mapSize.x !== n) {
      s.mapSize.set(n, n);
      if (s.map) { s.map.dispose(); s.map = null; }
    }
    if (this._lightDir.lengthSq()) this._fitShadow(this._lightDir);
  }

  setShadowsEnabled(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    // force material recompilation of shadow chunks
    this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  }

  /** Update everything for a new sun position. azimuth/elevation in degrees. */
  setSun(azimuthDeg, elevationDeg) {
    this.azimuth = azimuthDeg; this.elevation = elevationDeg;
    const a = azimuthDeg * DEG, e = elevationDeg * DEG;
    // world: X east, Y up, Z south
    this.sunDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
    const el = elevationDeg;

    // Sky shader sun position (keep slightly below horizon at night for a dark sky)
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    // Phases: day 0 night … 1 day; golden = low-sun warmth; dusk = civil twilight bell (peaks at el ≈ 0)
    const day = smooth(-5, 3, el);
    const golden = 1 - smooth(5, 35, el);
    const dusk = smooth(-9, -1.5, el) * (1 - smooth(1.5, 9, el));
    const deep = 1 - smooth(-12, -4, el);          // real night (exposure lift only here)
    this.night = 1 - day;
    this.dusk = dusk; this.golden = golden;
    // practical lights (builder-controlled exterior and interior lighting) switch on around sunset
    this.lightsOn = 1 - smooth(-1.5, 4.5, el);

    // Sky shader: hazier, redder and more forward-scattering towards sunset
    const su = this.sky.material.uniforms;
    su.turbidity.value = 4.2 + 4.8 * golden;
    su.rayleigh.value = 1.33 + 1.2 * golden * golden;
    su.mieCoefficient.value = 0.0055 + 0.0035 * golden;
    su.mieDirectionalG.value = 0.82 + 0.1 * golden;

    // Sun colour: neutral white high up → amber at golden hour → deep orange-red at the horizon
    const cDay = new THREE.Color(1.0, 0.965, 0.92);
    const cWarm = new THREE.Color(1.0, 0.60, 0.32);
    const cSet = new THREE.Color(1.0, 0.40, 0.16);
    const sunCol = cDay.clone().lerp(cWarm, Math.sqrt(golden)).lerp(cSet, 1 - smooth(-1, 6, el));
    // keep a raking, low-intensity disc light right down to the horizon (it is what makes dusk read)
    const sunI = Math.max(5.5 * smooth(-0.8, 10, el) * (0.82 + 0.18 * smooth(10, 60, el)), 2.1 * smooth(-1.8, 1.2, el));

    const moonDir = new THREE.Vector3(-0.35, 0.82, 0.45).normalize(); // high in the SW-ish
    const useMoon = el < -1.8;
    const lightDir = useMoon ? moonDir : this.sunDir.clone().setY(Math.max(this.sunDir.y, Math.sin(1.6 * DEG))).normalize();
    this.sun.color.copy(useMoon ? new THREE.Color(0.62, 0.72, 1.0) : sunCol);
    this.sun.intensity = useMoon ? 0.22 * this.night * smooth(2, 6, -el) : sunI;
    this.sun.position.copy(this.center).addScaledVector(lightDir, 260);
    this.sun.target.position.copy(this.center);
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
    this._fitShadow(this._lightDir.copy(lightDir));

    // Skylight stays cool as the direct beam warms. Neutral ground bounce
    // lifts vertical plaster and soffits without washing out the terrace.
    const skyDay = new THREE.Color(0xc9def7), skyGold = new THREE.Color(0xa9c5ed);
    this.hemi.color.set(0x334264).lerp(skyDay, day).lerp(skyGold, golden * day);
    this.hemi.groundColor.set(0x191c24).lerp(new THREE.Color(0xafaba3), day);
    // Higher sun puts more light onto the court, which bounces back into
    // balconies and shaded concrete. At low sun the cool sky carries the fill.
    const bounce = day * 2.8 * Math.max(0, this.sunDir.y - .30);
    this.hemi.intensity = .32 + .78 * day + .38 * dusk + bounce;
    this.scene.environmentIntensity = .13 + 1.04 * day + .44 * dusk;
    this.renderer.toneMappingExposure = this.exposureDay * (.93 + .24 * golden * day + 1.05 * dusk + .9 * deep);
    this.fogDensity = .00067 + .00085 * golden * day + .00035 * dusk;
    this._fogDim = 1 - .35 * dusk - .2 * this.night;
    this.requestEnv();
  }

  _fitShadow(lightDir) {
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    // Keep one map axis level. The other follows the foreshortened ground
    // depth, preserving terrace resolution at the winter morning sun angle.
    if (this.shadowMargin && Math.abs(lightDir.y) < .999999) cam.up.set(0, 1, 0);
    else cam.up.set(0, 0, -1);
    cam.lookAt(this.sun.target.position);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const p = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const corner of shadowHull) {
      p.copy(corner).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    // Project a horizontal 70 m disc onto each light-space axis. This gives
    // the exact bounds of the buffered footprint for the current azimuth.
    const m = inv.elements;
    const margin = axis => this.shadowMargin * Math.hypot(m[axis], m[axis + 8]);
    const dx = margin(0) + 1, dy = margin(1) + 1, dz = margin(2) + 2;
    cam.left = minX - dx; cam.right = maxX + dx;
    cam.bottom = minY - dy; cam.top = maxY + dy;
    cam.near = Math.max(.5, -maxZ - dz);
    cam.far = -minZ + Math.max(dz, Math.min(roofTop / lightDir.y, this.shadowMargin || Infinity)) + 2;
    // Keep bias in metres as the depth range changes through the day.
    this.sun.shadow.bias = this.shadowMargin ? -.003 / (cam.far - cam.near) : -.00012;
    this.sun.shadow.normalBias = this.shadowMargin ? .012 : .022;
    cam.updateProjectionMatrix();
  }

  // A constant radiance atlas supplies diffuse fill during streaming. Matching
  // the final CubeUV dimensions keeps every PBR program linked when PMREM arrives.
  seedEnvironment() {
    const r = this.renderer, low = this.quality === 'low';
    const target = new THREE.WebGLRenderTarget(low ? 336 : 768, low ? 256 : 1024,
      {type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer:false, colorSpace:THREE.LinearSRGBColorSpace});
    target.texture.mapping = THREE.CubeUVReflectionMapping;
    const previous = r.getRenderTarget(), color = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    const radiance = new THREE.Color(1.38, 1.46, 1.55).multiplyScalar(1 - this.night);
    r.setRenderTarget(target);
    r.setClearColor(radiance); r.clearColor();
    r.setClearColor(color, alpha); r.setRenderTarget(previous);
    this.seedRT = target;
    this.scene.environment = target.texture;
    this.revision++;
    this.scene.fog.color.copy(radiance);
  }

  requestEnv(force = false) {
    this._envPending = true;
    if (force) this._lastEnvDir.copy(this.sunDir).negate();
  }

  /** Call every frame; regenerates the env map when the sun moved > 1° (throttled to 4 Hz). */
  update(now, force = false) {
    if (!this._envPending && !force) return false;
    const moved = this._lastEnvDir.angleTo(this.sunDir) / DEG;
    if (!force && moved < 1.0) { this._envPending = false; return false; }
    if (!force && now - this._lastEnvTime < (this.envInterval || 250)) return false;
    // the horizon read-back is a synchronous GPU→CPU stall: while the day is playing only redo it
    // when the sun moved noticeably (fog colour changes slowly)
    const readH = force || !this._lastHorizonDir || this._lastHorizonDir.angleTo(this.sunDir) / DEG > (this.envInterval > 400 ? 4 : 1);
    this._regenEnv(readH ? this._readHorizon() : null);
    this._lastEnvTime = now; this._lastEnvDir.copy(this.sunDir); this._envPending = false;
    return true;
  }

  async prepare(breathe) {
    // Read the four horizon probes together. The asynchronous fence leaves input
    // and camera frames live while the GPU finishes drawing the sky.
    const sampledSun = this.sunDir.clone();
    this._drawHorizon();
    await this.renderer.readRenderTargetPixelsAsync(this.horizonRT, 0, 1, 16, 1, this._px);
    await breathe();
    // Scrubbing time while the fence is pending can move the horizon to another hour.
    const fog = sampledSun.angleTo(this.sunDir) > DEG ? this._readHorizon() : this._horizonColor();
    this._regenEnv(fog);
    this._lastEnvTime = performance.now();
    this._lastEnvDir.copy(this.sunDir); this._envPending = false;
  }

  async readDiffuseFaces() {
    const rt = this.envRT;
    if (!rt || !this.hdr) return null;
    // r170 packs its roughest PMREM mip as six 16px faces in a 48×32 strip.
    // Read once per lighting change instead of fetching the atlas at every vertex.
    const face = 16, width = 3 * face;
    const data = new Uint16Array(width * 2 * face * 4);
    await this.renderer.readRenderTargetPixelsAsync(rt, 6 * width, rt.height - 4 * face, width, 2 * face, data);
    const rgb = new Float32Array(18);
    for (let side = 0; side < 6; side++) {
      const x = (side % 3) * face + 7, y = (side < 3 ? 0 : face) + 7;
      for (let c = 0; c < 3; c++) {
        for (const offset of [0, 1, width, width + 1]) {
          rgb[3 * side + c] += .25 * THREE.DataUtils.fromHalfFloat(data[4 * (y * width + x + offset) + c]);
        }
      }
    }
    return rgb.every(Number.isFinite) ? rgb : null;
  }

  _regenEnv(fogCol) {
    const r = this.renderer;
    if (fogCol) this._lastHorizonDir = (this._lastHorizonDir || new THREE.Vector3()).copy(this.sunDir);
    if (fogCol) {
      // twilight haze is dimmer than the bright sky band right at the horizon (otherwise distant
      // satellite ground looks pasted-on and brighter than the site)
      this._lastFog = fogCol.clone();
      const lum = 0.2126 * fogCol.r + 0.7152 * fogCol.g + 0.0722 * fogCol.b;
      // ground bounce ≈ albedo × (sun + sky) — scaled from sky brightness
      const g = new THREE.Color(0.42, 0.34, 0.25).multiplyScalar(Math.min(lum * 0.55 + 0.25 * this.sun.intensity * Math.max(0, this.sunDir.y) * (1 - this.night), 3));
      this.envGroundMat.color.copy(g);
    }
    if (this._lastFog) this.scene.fog.color.copy(this._lastFog).multiplyScalar(this._fogDim)
      .lerp(new THREE.Color(1.36, 1.04, .76), .25 * this.golden * (1 - this.night));
    // r170 requires renderable half-float buffers to filter a radiance atlas.
    if (!this.hdr) { this.seedRT?.dispose(); this.seedEnvironment(); return; }
    // 2) PMREM
    this.pmrem ??= new THREE.PMREMGenerator(r);
    let rt;
    if (this.quality === 'low') {
      // fromScene always bakes 256px faces in r170. This sky has no fine texture.
      this.envCube ??= new THREE.WebGLCubeRenderTarget(64, {type: THREE.HalfFloatType});
      this.cubeCamera ??= new THREE.CubeCamera(.1, 2000, this.envCube);
      this.cubeCamera.update(r, this.envScene);
      const reuse = this.envRT?.height === 256 ? this.envRT : null;
      rt = this.pmrem.fromCubemap(this.envCube.texture, reuse);
    } else {
      this.envCube?.dispose(); this.envCube = this.cubeCamera = null;
      rt = this.pmrem.fromScene(this.envScene, 0, .1, 2000);
    }
    if (this.envRT !== rt) this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.revision++;
    this.seedRT?.dispose(); this.seedRT = null;
  }

  _drawHorizon() {
    const r = this.renderer, previous = r.getRenderTarget(), cam = this.horizonCam;
    const offsets = [.5, 1, 1.5, .35];
    try {
      for (let i = 0; i < offsets.length; i++) {
        const a = this.azimuth * DEG + offsets[i] * Math.PI;
        cam.lookAt(Math.sin(a), Math.sin(2.5 * DEG), -Math.cos(a));
        cam.updateMatrixWorld();
        this.horizonRT.viewport.set(i * 4, 0, 4, 4);
        this.horizonRT.scissor.copy(this.horizonRT.viewport);
        this.horizonRT.scissorTest = true;
        r.setRenderTarget(this.horizonRT);
        r.render(this.envScene, cam);
      }
    } finally { r.setRenderTarget(previous); }
  }

  _horizonColor() {
    const sum = new THREE.Color(0, 0, 0);
    let count = 0;
    for (let i = 4; i < this._px.length; i += 16) {
      const [r,g,b] = this._px.subarray(i, i+3);
      if (Number.isFinite(r + g + b)) { sum.r += r; sum.g += g; sum.b += b; count++; }
    }
    if (!count) return null;
    sum.multiplyScalar(1 / (count * (this._px instanceof Uint8Array ? 255 : 1)));
    sum.r = clamp(sum.r, .002, 20); sum.g = clamp(sum.g, .002, 20); sum.b = clamp(sum.b, .002, 20);
    return sum;
  }

  _readHorizon() {
    this._drawHorizon();
    this.renderer.readRenderTargetPixels(this.horizonRT, 0, 1, 16, 1, this._px);
    return this._horizonColor();
  }
}
