// ============================================================================
//  Renderer, quality presets and post-processing chain.
//  RenderPass → GTAO (high) → UnrealBloom (subtle, high/medium) → OutputPass → SMAA / FXAA
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// r170's soft PCF compares centre depth at neighbouring texels. On a large
// oblique terrace that shadows the receiver itself in diagonal bands. Compare
// each tap at its own depth on the receiver plane, then bilinearly filter.
// The print maps resolve contacts with four taps; smaller maps use native PCF.
const shadowChunk = THREE.ShaderChunk.shadowmap_pars_fragment;
THREE.ShaderChunk.shadowmap_pars_fragment = shadowChunk.replace('if ( frustumTest ) {', `
  #ifdef SHADOWMAP_TYPE_PCF_SOFT
  if (shadowMapSize.x >= 4096.0) {
    vec3 plane = cross(dFdx(shadowCoord.xyz), dFdy(shadowCoord.xyz));
    vec2 slope = abs(plane.z) > 1e-14 ? -plane.xy / (plane.z * shadowMapSize) : vec2(0.);
    slope = clamp(slope, vec2(-.002), vec2(.002)); // nearly edge-on surfaces
    if (frustumTest) {
      vec2 grid = shadowCoord.xy * shadowMapSize - .5;
      vec2 f = fract(grid);
      vec2 texel = 1. / shadowMapSize;
      vec2 uv = (floor(grid) + .5) * texel;
      float z = shadowCoord.z - dot(f, slope);
      float a = texture2DCompare(shadowMap, uv, z);
      float b = texture2DCompare(shadowMap, uv + vec2(texel.x, 0.), z + slope.x);
      float c = texture2DCompare(shadowMap, uv + vec2(0., texel.y), z + slope.y);
      float d = texture2DCompare(shadowMap, uv + texel, z + slope.x + slope.y);
      shadow = mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
    }
  } else
  #endif
  if ( frustumTest ) {`);

export const QUALITY = {
  ultra:  { label: 'Ultra',  pixelRatio: 2,   shadow: 8192, gtao: true,  bloom: true,  aa: 'smaa' },
  high:   { label: 'High',   pixelRatio: 2,   shadow: 4096, gtao: true,  bloom: true,  aa: 'smaa' },
  medium: { label: 'Medium', pixelRatio: 1.5, shadow: 2048, gtao: false, bloom: true,  aa: 'smaa' },
  low:    { label: 'Low',    pixelRatio: 1,   shadow: 1024, gtao: false, bloom: false, aa: 'fxaa' },
};

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uBalance: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1.08 },
    uSat: { value: 1.02 },
    uShoulder: { value: 0.78 },
    uVignette: { value: 0.16 },
    uLift: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec3 uBalance; uniform float uContrast; uniform float uSat;
    uniform float uShoulder; uniform float uVignette; uniform float uLift; varying vec2 vUv;
    vec3 shoulder(vec3 x) { // linear below uShoulder, smooth roll-off to ≈0.94 above
      float s = uShoulder, r = 0.94 - s;
      vec3 over = max(x - s, 0.0);
      return min(x, vec3(s)) + r * (1.0 - exp(-over / r));
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uBalance;
      // S-curve around mid-grey (display space)
      col = clamp(col, 0.0, 1.2);
      vec3 sc = col - 0.46;
      col = 0.46 + sc * uContrast - sc * abs(sc) * (uContrast - 1.0) * 0.9;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = shoulder(max(col, 0.0));
      // twilight/night: cool, gentle shadow lift (keeps dark roofs & foliage readable without greying mid-tones)
      float lw = 1.0 - smoothstep(0.0, 0.32, dot(col, vec3(0.2126, 0.7152, 0.0722)));
      col += uLift * lw * vec3(0.62, 0.74, 1.0);
      // vignette
      vec2 q = vUv - 0.5; float v = 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.2);
      gl_FragColor = vec4(col * v, c.a);
    }`,
};

export function isMobileDevice() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  return coarse && (small || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
}

/** Pick a sensible default quality for this device. */
export function autoQuality(renderer) {
  let rendererName = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    rendererName = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) { /* ignore */ }
  if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(rendererName)) return 'low';
  if (isMobileDevice()) {
    const phone = Math.min(screen.width, screen.height) < 600;
    return phone ? 'low' : 'medium';
  }
  // High (GTAO, 4K shadows, 2× pixels) only on discrete / high-end GPUs; integrated laptop GPUs
  // (Intel, Adreno, Radeon Graphics, base Apple M) get Medium. The app adapts further at runtime.
  if (/NVIDIA|GeForce|RTX|Quadro|Radeon\s*(RX|Pro|R9|VII)|Arc\(TM\)\s*A|Apple M\d+\s*(Pro|Max|Ultra)/i.test(rendererName)) return 'high';
  return 'medium';
}

// Explicit levels keep byte-backed sRGB albedo textures complete on integrated WebGL
// drivers. Missing lower levels otherwise turn powder-coated equipment black at distance.
export function prepareColorMipmaps(scene) {
  scene.traverse(o => {
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      const map = material?.map;
      if (!map?.isDataTexture || !map.generateMipmaps || map.mipmaps.length ||
          map.type !== THREE.UnsignedByteType || map.format !== THREE.RGBAFormat ||
          map.colorSpace !== THREE.SRGBColorSpace) continue;
      const base = map.image;
      const canvas = document.createElement('canvas');
      canvas.width = base.width; canvas.height = base.height;
      const g = canvas.getContext('2d', {willReadFrequently:true});
      g.putImageData(new ImageData(new Uint8ClampedArray(base.data), base.width, base.height), 0, 0);
      const levels = [base];
      let w = base.width, h = base.height;
      while (w > 1 || h > 1) {
        const nextW = Math.max(1, w >> 1), nextH = Math.max(1, h >> 1);
        g.drawImage(canvas, 0, 0, w, h, 0, 0, nextW, nextH);
        levels.push({width:nextW, height:nextH, data:new Uint8Array(g.getImageData(0,0,nextW,nextH).data.buffer)});
        w = nextW; h = nextH;
      }
      map.mipmaps = levels;
      map.generateMipmaps = false;
      map.needsUpdate = true;
    }
  });
}

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // AA is done in post (SMAA/FXAA)
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x9fb4c8, 1);
  container.appendChild(renderer.domElement);
  renderer.domElement.id = 'gl';
  return renderer;
}

/** Post-processing chain; rebuild() whenever the camera object or quality changes. */
export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.quality = quality;
    this.width = 1; this.height = 1; this.pixelRatio = 1;
    this.stats = { calls: 0, triangles: 0 };
    this.enabled = true;
    this.rebuild();
  }

  rebuild() {
    if (this.composer) {
      this.composer.passes.forEach((p) => p.dispose && p.dispose());
      this.composer.dispose();
    }
    const q = QUALITY[this.quality];
    const r = this.renderer;
    const composer = new EffectComposer(r);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.width, this.height);
    const w = this.width, h = this.height;

    const renderPass = new RenderPass(this.scene, this.camera);
    const origRender = renderPass.render.bind(renderPass);
    renderPass.render = (...a) => {
      r.info.reset();
      origRender(...a);
      this.stats.calls = r.info.render.calls; this.stats.triangles = r.info.render.triangles;
    };
    composer.addPass(renderPass);
    this.renderPass = renderPass;

    this.gtao = null;
    if (q.gtao) {
      const gtao = new GTAOPass(this.scene, this.camera, w, h);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 1.0;
      gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 1.6, scale: 1.15, samples: this.quality === 'ultra' ? 32 : 12, distanceFallOff: 1.0 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: this.quality === 'ultra' ? 24 : 12 });
      // Hide alpha-tested leaf cards, glass and overlays from the AO G-buffer (they would render as solid quads)
      const baseOverride = gtao.overrideVisibility.bind(gtao);
      gtao.overrideVisibility = function () {
        baseOverride();
        this.scene.traverse((o) => {
          if (!o.visible) return;
          const m = o.material;
          if (o.userData && o.userData.noAO) { this._visibilityCache.has(o) || this._visibilityCache.set(o, o.visible); o.visible = false; return; }
          if (m && !Array.isArray(m) && (m.alphaTest > 0 || m.transparent || m.depthTest === false)) {
            if (!this._visibilityCache.has(o)) this._visibilityCache.set(o, o.visible);
            o.visible = false;
          }
          if (o.isSprite || o.isCSS2DObject) { if (!this._visibilityCache.has(o)) this._visibilityCache.set(o, o.visible); o.visible = false; }
        });
      };
      composer.addPass(gtao);
      this.gtao = gtao;
    }

    this.bloom = null;
    if (q.bloom) {
      // threshold is in linear HDR (pre-exposure) units; only sun glints & emissive lamps exceed it.
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.12, 0.35, 6.0);
      // A single invalid HDR reflection can spread across an entire blur pyramid.
      // Reject non-finite samples before filtering and cap the energy of tiny glints.
      const prefilter = bloom.materialHighPassFilter;
      prefilter.fragmentShader = prefilter.fragmentShader.replace('float v = luminance', `
        if (any(isnan(texel)) || any(isinf(texel))) texel = vec4(0.0);
        texel.rgb = clamp(texel.rgb, 0.0, 32.0);
        float v = luminance`);
      for (const material of [prefilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial]) {
        if (material) { material.depthTest = false; material.depthWrite = false; }
      }
      composer.addPass(bloom);
      this.bloom = bloom;
    }

    composer.addPass(new OutputPass());

    // Display-space colour grade (cheap, all qualities): filmic highlight shoulder so white masonry /
    // PPGI never clips, gentle S-curve for midtone contrast, neutral-warm balance (removes the
    // cyan-pastel cast), a touch of vignette; warmer/rosier at golden hour & dusk.
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    this.grade = grade;
    this._applyGrade();

    this.fxaa = null;
    if (q.aa === 'smaa') {
      composer.addPass(new SMAAPass(w * this.pixelRatio, h * this.pixelRatio));
    } else {
      const fxaa = new ShaderPass(FXAAShader);
      composer.addPass(fxaa);
      this.fxaa = fxaa;
    }
    // The composer alternates two targets which also hold scene depth. A colour-only
    // fullscreen pass must cover every pixel, even where a previous pass wrote depth.
    for (const pass of composer.passes) {
      for (const material of [pass.material, pass.materialEdges, pass.materialWeights, pass.materialBlend]) {
        if (material) { material.depthTest = false; material.depthWrite = false; }
      }
    }
    this.composer = composer;
    this._updateFxaa();
  }

  /** golden 0…1 (low sun warmth), dusk 0…1 (civil twilight), night 0…1 */
  setGrade(golden = 0, dusk = 0, night = 0) { this._g = { golden, dusk, night }; this._applyGrade(); }

  _applyGrade() {
    if (!this.grade) return;
    const { golden = 0, dusk = 0, night = 0 } = this._g || {};
    const u = this.grade.uniforms;
    const day = 1 - Math.max(dusk, night);
    // white balance multiplier (display space)
    u.uBalance.value.set(1.0 + 0.012 * day + 0.05 * golden * day + 0.07 * dusk, 1.0 - 0.012 * dusk, 0.965 * day + (1 - day) * (0.97 + 0.06 * night) - 0.035 * dusk);
    u.uContrast.value = 1.0 + 0.1 * day + 0.04 * dusk;
    u.uSat.value = 1.02 + 0.1 * dusk - 0.12 * night;
    u.uLift.value = 0.045 * dusk + 0.025 * night;
  }

  _updateFxaa() {
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (this.width * this.pixelRatio), 1 / (this.height * this.pixelRatio));
  }

  setCamera(camera) { if (camera !== this.camera) { this.camera = camera; this.rebuild(); } }
  setQuality(q) { if (q !== this.quality) { this.quality = q; this.rebuild(); } }

  setSize(w, h, pixelRatio) {
    this.width = w; this.height = h; this.pixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, true);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this._updateFxaa();
  }

  render(dt) {
    if (this.renderPass.camera !== this.camera) this.renderPass.camera = this.camera;
    this.composer.render(dt);
  }
}
