// ============================================================================
//  Renderer, quality presets and post-processing chain.
//  Multisampled HDR scene, optional AO and bloom, then a display-space grade.
// ============================================================================
import * as THREE from 'three';
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
  ultra:  { label: 'Ultra',  pixelRatio: 2,   shadow: 8192, gtao: true,  bloom: true },
  high:   { label: 'High',   pixelRatio: 2,   shadow: 4096, gtao: true,  bloom: true },
  medium: { label: 'Medium', pixelRatio: 2,   shadow: 2048, gtao: false, bloom: true },
  low:    { label: 'Low',    pixelRatio: 2,   shadow: 2048, gtao: false, bloom: false },
};

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    uBalance: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1.08 },
    uSat: { value: 1.02 },
    uShoulder: { value: 0.78 },
    uVignette: { value: 0.16 },
    uLift: { value: 0 },
  },
  fragmentShader: /* glsl */`
    uniform vec3 uBalance; uniform float uContrast; uniform float uSat;
    uniform float uShoulder; uniform float uVignette; uniform float uLift;
    vec3 shoulder(vec3 x) { // linear below uShoulder, smooth roll-off to ≈0.94 above
      float s = uShoulder, r = 0.94 - s;
      vec3 over = max(x - s, 0.0);
      return min(x, vec3(s)) + r * (1.0 - exp(-over / r));
    }
    vec4 gradeColor(vec4 c, vec2 vUv) {
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
      return vec4(col * v, c.a);
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
export async function prepareColorMipmaps(scene, breathe) {
  const maps = new Set();
  scene.traverse(o => {
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      const map = material?.map;
      if (!map?.isDataTexture || !map.generateMipmaps || map.mipmaps.length ||
          map.type !== THREE.UnsignedByteType || map.format !== THREE.RGBAFormat ||
          map.colorSpace !== THREE.SRGBColorSpace) continue;
      maps.add(map);
    }
  });
  for (const map of maps) {
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
    canvas.width = canvas.height = 0;
    if (breathe) await breathe();
  }
}

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // The scene target owns the samples.
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
    depth: false, // The canvas receives only the graded fullscreen triangle.
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

/** Scene and post targets are allocated per tier and reused across frames and camera changes. */
export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.quality = quality;
    this.width = 1; this.height = 1; this.pixelRatio = 1;
    this.stats = { calls: 0, triangles: 0 };
    this.fences = [];
    this.authoredHooks = new WeakMap();
    this.farMeshes = [];
    this.farSky = {value: new Float32Array(18)};
    this.farIntensity = {value: 1};
    this.farMaterials = new Map();
    this.enabled = true;
    this.rebuild();
  }

  rebuild() {
    for (const m of this.farMaterials.values()) m.dispose();
    this.farMaterials.clear();
    this.farMeshes.length = 0;
    this.terrainAtlas?.dispose();
    this.terrainMaterial?.dispose();
    this.terrainAtlas = this.terrainMaterial = null;
    this.groundRevision = -1;
    for (const resource of [this.sceneTarget, this.motionTarget, this.aux, this.grade, this.aa, this.gtao, this.bloom]) resource?.dispose();
    const q = QUALITY[this.quality], r = this.renderer, gl = r.getContext();
    const w = this.width, h = this.height;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const software = /SwiftShader|llvmpipe|Software|Basic Render/i.test(
      gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const hdr = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
    const supported = hdr && gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    this.samples = !software && r.capabilities.maxSamples >= 4 && supported && supported.includes(4) ? 4 : 0;
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {type, samples: this.samples, resolveDepthBuffer: false});
    this.motionTarget = null;
    this.canUseTwoSamples = this.samples === 4 && supported.includes(2);
    this.sceneScale = 1;
    this.useTwoSamples = false;
    this.aa = this.samples ? null : software ? new ShaderPass(FXAAShader) : new SMAAPass(1, 1);
    this.fxaa = software ? this.aa : null;
    for (const rt of [this.aa?.edgesRT, this.aa?.weightsRT]) {
      if (rt) { rt.texture.type = THREE.UnsignedByteType; rt.depthBuffer = false; }
    }
    this.aux = q.gtao || this.aa ? new THREE.WebGLRenderTarget(1, 1, {type, depthBuffer:false}) : null;
    this.gtao = null;
    if (q.gtao && hdr) {
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
      this.gtao = gtao;
    }

    this.bloom = null;
    if (q.bloom && hdr) {
      // threshold is in linear HDR (pre-exposure) units; only sun glints & emissive lamps exceed it.
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.12, 0.35, 6.0);
      // A single invalid HDR reflection can spread across an entire blur pyramid.
      // Reject non-finite samples before filtering and cap the energy of tiny glints.
      for (const rt of [bloom.renderTargetBright, ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical]) rt.depthBuffer = false;
      const prefilter = bloom.materialHighPassFilter;
      prefilter.fragmentShader = prefilter.fragmentShader.replace('float v = luminance', `
        if (any(isnan(texel)) || any(isinf(texel))) texel = vec4(0.0);
        texel.rgb = clamp(texel.rgb, 0.0, 32.0);
        float v = luminance`);
      for (const material of [prefilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, bloom.blendMaterial]) {
        if (material) { material.depthTest = false; material.depthWrite = false; }
      }
      this.bloom = bloom;
    }

    // OutputPass maintains Three's exact exposure, tone mapping and transfer function.
    // Append the existing display-space grade to its fragment shader before the write.
    const output = new OutputPass();
    output.material.fragmentShader = output.material.fragmentShader
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse; uniform vec2 sourceScale;')
      .replace('texture2D( tDiffuse, vUv )', 'texture2D( tDiffuse, vUv * sourceScale )')
      .replace('void main()', GradeShader.fragmentShader + '\nvoid main()')
      .replace(/}\s*$/, 'gl_FragColor = gradeColor(gl_FragColor, vUv);\n}');
    Object.assign(output.uniforms, THREE.UniformsUtils.clone(GradeShader.uniforms));
    output.uniforms.sourceScale = {value: new THREE.Vector2(1, 1)};
    this.grade = output;
    for (const mat of [output.material, this.aa?.material, this.aa?.materialEdges,
      this.aa?.materialWeights, this.aa?.materialBlend]) {
      if (mat) { mat.depthTest = false; mat.depthWrite = false; }
    }
    this._applyGrade();
    this._sizeTargets();
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

  setCamera(camera) {
    if (camera === this.camera) return;
    this.camera = camera;
    if (this.gtao) {
      this.gtao.camera = camera;
      this.gtao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = camera.isPerspectiveCamera ? 1 : 0;
      this.gtao.gtaoMaterial.needsUpdate = true;
    }
  }

  setQuality(q) { if (q !== this.quality) { this.quality = q; this.rebuild(); } }

  _sizeTargets() {
    const w = Math.max(1, Math.floor(this.width * this.pixelRatio));
    const h = Math.max(1, Math.floor(this.height * this.pixelRatio));
    for (const pass of [this.sceneTarget, this.aux, this.aa, this.bloom, this.gtao]) pass?.setSize(w, h);
    this._updateFxaa();
  }

  setSize(w, h, pixelRatio) {
    if (this.width === w && this.height === h && this.pixelRatio === pixelRatio) return;
    this.width = w; this.height = h; this.pixelRatio = pixelRatio;
    this.renderer.setDrawingBufferSize(w, h, pixelRatio);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this._sizeTargets();
  }

  prepareMotion(isPhone) {
    // The phone keeps its single scene target. Large print surfaces also avoid a second HDR buffer.
    if (!this.canUseTwoSamples || isPhone || this.quality === 'low' ||
        this.sceneTarget.width * this.sceneTarget.height > 3200000) {
      this.motionTarget?.dispose();
      this.motionTarget = null;
      return;
    }
    this.motionTarget ??= new THREE.WebGLRenderTarget(1, 1, {
      type: this.sceneTarget.texture.type, samples: 2, resolveDepthBuffer: false,
    });
    this.motionTarget.setSize(this.sceneTarget.width, this.sceneTarget.height);
    this.renderer.initRenderTarget(this.motionTarget);
  }

  rememberMaterials(root) {
    root.traverse(o => {
      const m = o.material;
      if (m?.isMeshStandardMaterial && !this.authoredHooks.has(m))
        this.authoredHooks.set(m, m.onBeforeCompile);
    });
  }

  async prepareFarMaterials(camera, yieldToInput) {
    for (const m of this.farMaterials.values()) m.dispose();
    this.farMaterials.clear();
    this.farMeshes.length = 0;
    if (!this.motionTarget || this.quality !== 'medium') return;
    const batch = new THREE.Group();
    this.scene.traverse(o => {
      const m = o.material;
      if (!m?.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.roughness < .45 ||
          m.metalness > .4 || m.transparent || !this.authoredHooks.has(m)) return;
      const hook = this.authoredHooks.get(m);
      // Foliage's authored cutout/normal hook also works with the Lambert shader.
      if (hook !== THREE.Material.prototype.onBeforeCompile && !(m.alphaTest && m.alphaToCoverage)) return;
      let far = this.farMaterials.get(m);
      if (!far) {
        far = new THREE.MeshLambertMaterial();
        for (const key of ['color','vertexColors','map','emissive','emissiveMap','emissiveIntensity',
          'aoMap','aoMapIntensity','alphaTest','alphaMap','alphaToCoverage','side','shadowSide',
          'depthTest','depthWrite','polygonOffset','polygonOffsetFactor','polygonOffsetUnits']) far[key] = m[key];
        far.customProgramCacheKey = () => 'farDiffuse|' + hook.toString();
        far.onBeforeCompile = (shader, renderer) => {
          hook.call(far, shader, renderer);
          shader.uniforms.farSky = this.farSky;
          shader.uniforms.farIntensity = this.farIntensity;
          // Axis-aligned walls and roofs use the measured PMREM face directly.
          // Smooth normals blend the six cardinal irradiances in world space.
          shader.vertexShader = 'uniform vec3 farSky[6]; varying vec3 vFarFill;\n' + shader.vertexShader
            .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
              vec3 n = inverseTransformDirection(transformedNormal, viewMatrix);
              vec3 w = n * n;
              vFarFill = w.x * (n.x >= 0. ? farSky[0] : farSky[3]) +
                w.y * (n.y >= 0. ? farSky[1] : farSky[4]) +
                w.z * (n.z >= 0. ? farSky[2] : farSky[5]);`);
          shader.fragmentShader = 'varying vec3 vFarFill; uniform float farIntensity;\n' + shader.fragmentShader
            .replace('#include <lights_fragment_end>', 'irradiance += PI * farIntensity * vFarFill;\n#include <lights_fragment_end>');
        };
        this.farMaterials.set(m, far);
      }
      this.farMeshes.push({mesh:o, full:m, far});
      const proxy = Object.create(o);
      proxy.material = far; proxy.children = [];
      batch.children.push(proxy);
    });
    const r = this.renderer, target = this.motionTarget;
    const pending = [];
    const meshes = batch.children;
    for (let i = 0; i < meshes.length; i += 8) {
      await yieldToInput();
      if (target !== this.motionTarget) break;
      batch.children = meshes.slice(i, i + 8);
      const previous = r.getRenderTarget();
      try {
        r.setRenderTarget(target);
        pending.push(r.compileAsync(batch, camera, this.scene));
      } finally { r.setRenderTarget(previous); }
    }
    await Promise.all(pending);
  }

  useFarMaterials(on) {
    this.farIntensity.value = this.scene.environmentIntensity;
    for (const {mesh,full,far} of this.farMeshes) {
      if (mesh.material === (on ? full : far)) mesh.material = on ? far : full;
    }
  }

  bakeDistantGround(ground, center, revision) {
    if (!this.motionTarget || this.quality !== 'medium' || !ground?.isMesh) return;
    const r = this.renderer, previous = r.getRenderTarget(), dirty = r.shadowMap.needsUpdate;
    const original = ground.material, blend = original.blending;
    // Ground and shadows are static between scene edits. Two top-down views retain the
    // authored satellite and paving colours when the distant terrain is subpixel.
    this.terrainAtlas ??= new THREE.WebGLRenderTarget(2048, 1024, {
      type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps:true, minFilter:THREE.LinearMipmapLinearFilter,
    });
    const atlas = this.terrainAtlas;
    const bake = new THREE.Scene();
    bake.environment = this.scene.environment;
    bake.environmentIntensity = this.scene.environmentIntensity;
    bake.fog = this.scene.fog?.clone() ?? null;
    if (bake.fog) bake.fog.density = 0;
    bake.children = [ground, ...this.scene.children.filter(o => o.isLight)];
    const camera = new THREE.OrthographicCamera();
    camera.up.set(0, 0, -1);
    camera.position.set(center.x, 150, -center.y);
    camera.lookAt(center.x, 0, -center.y);
    try {
      r.shadowMap.needsUpdate = false;
      original.blending = THREE.NoBlending;
      atlas.scissorTest = true;
      for (const [i, radius] of [256, 2600].entries()) {
        camera.left = camera.bottom = -radius; camera.right = camera.top = radius;
        camera.updateProjectionMatrix();
        atlas.viewport.set(i * 1024, 0, 1024, 1024);
        atlas.scissor.copy(atlas.viewport);
        atlas.texture.generateMipmaps = i === 1;
        r.setRenderTarget(atlas);
        r.render(bake, camera);
      }
    } finally {
      original.blending = blend;
      r.shadowMap.needsUpdate = dirty;
      r.setRenderTarget(previous);
    }
    this.terrainMaterial ??= new THREE.ShaderMaterial({
      transparent:true, fog:true, uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        atlas:{value:atlas.texture}, origin:{value:new THREE.Vector2(center.x, -center.y)}},
      vertexShader:`varying vec2 offset; uniform vec2 origin;
        #include <fog_pars_vertex>
        void main() { vec4 world = modelMatrix * vec4(position, 1.);
          offset = (world.xz - origin) * vec2(1., -1.);
          vec4 mvPosition = viewMatrix * world; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader:`uniform sampler2D atlas; varying vec2 offset;
        #include <fog_pars_fragment>
        void main() {
          vec2 nearUV = clamp(offset / 512. + .5, .001, .999);
          vec2 farUV = clamp(offset / 5200. + .5, .001, .999);
          float blend = smoothstep(225., 250., max(abs(offset.x), abs(offset.y)));
          vec4 farColor = texture2D(atlas, vec2(.5 + .5 * farUV.x, farUV.y));
          gl_FragColor = mix(texture2D(atlas, vec2(.5 * nearUV.x, nearUV.y)), farColor, blend);
          #include <fog_fragment>
        }`,
    });
    this.groundRevision = revision;
  }

  async warmMotion(camera, ground, details, breathe) {
    if (!this.motionTarget) return;
    const r = this.renderer, target = this.motionTarget;
    const previous = r.getRenderTarget(), dirty = r.shadowMap.needsUpdate;
    const terrain = ground?.material;
    const viewport = target.viewport.clone();
    const gl = r.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const queries = [];
    const full = this.sceneTarget;
    const probe = (rt, tier) => {
      const query = gl.createQuery();
      r.setRenderTarget(rt);
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      try { r.render(this.scene, camera); }
      finally { gl.endQuery(timer.TIME_ELAPSED_EXT); }
      queries.push({tier,query});
    };
    try {
      // ANGLE can specialize a linked program for the sample count on its first draw.
      // Exercise both material sets on the actual two-sample framebuffer.
      r.shadowMap.needsUpdate = false;
      target.viewport.set(0, 0, 8, 8);
      r.setRenderTarget(target);
      r.render(this.scene, camera);
      this.useFarMaterials(true);
      if (ground && this.terrainMaterial) ground.material = this.terrainMaterial;
      r.render(this.scene, camera);
    } finally {
      if (ground) ground.material = terrain;
      this.useFarMaterials(false);
      r.shadowMap.needsUpdate = dirty;
      target.viewport.copy(viewport);
      r.setRenderTarget(previous);
    }
    if (!timer || this.quality !== 'medium') return;
    // Measure native scene cost after the first actual two-sample draw. Submit
    // one probe per task so input can interrupt calibration. No readback stalls.
    for (const tier of [1, 1, 1, 3, 4]) {
      await breathe();
      if (this.motionTarget !== target || gl.isContextLost()) break;
      const visible = tier === 4 ? details.filter(o => o.visible) : [];
      const saved = r.getRenderTarget(), refresh = r.shadowMap.needsUpdate;
      try {
        r.shadowMap.needsUpdate = false;
        if (tier === 4) {
          this.useFarMaterials(true);
          if (ground && this.terrainMaterial) ground.material = this.terrainMaterial;
          for (const o of visible) o.visible = false;
        }
        probe(tier === 1 ? full : target, tier);
      } finally {
        if (tier === 4) {
          if (ground) ground.material = terrain;
          this.useFarMaterials(false);
          for (const o of visible) o.visible = true;
        }
        r.shadowMap.needsUpdate = refresh;
        r.setRenderTarget(saved);
      }
    }
    return () => {
      const times = queries.map(({query}) => {
        const ms = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) ?
          gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 : 0;
        gl.deleteQuery(query);
        return ms;
      });
      if (times.length !== 5 || times.includes(0) || gl.getParameter(timer.GPU_DISJOINT_EXT)) return 0;
      if (times.slice(0,3).sort((a,b) => a-b)[1] <= 20) return 0;
      return times[3] <= 16 ? 3 : times[4] <= 16 ? 4 : 5;
    };
  }

  // The GL command queue can accept several costly frames before rAF misses a
  // vsync. Limit latency by drawing the newest camera pose when capacity returns.
  gpuFramesPending() {
    const gl = this.renderer.getContext();
    while (this.fences.length) {
      if (gl.clientWaitSync(this.fences[0], 0, 0) === gl.TIMEOUT_EXPIRED) break;
      gl.deleteSync(this.fences.shift());
    }
    return this.fences.length;
  }

  trackSubmission() {
    const gl = this.renderer.getContext();
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (sync) this.fences.push(sync);
    gl.flush();
  }

  render(dt) {
    const r = this.renderer;
    let source = this.useTwoSamples && this.motionTarget || this.sceneTarget;
    // Keep the canvas native and change only the rendered portion of the existing target.
    // Grade samples this rectangle and applies the vignette in display coordinates.
    const w = Math.max(1, Math.floor(source.width * this.sceneScale));
    const h = Math.max(1, Math.floor(source.height * this.sceneScale));
    source.viewport.set(0, 0, w, h);
    source.scissor.copy(source.viewport);
    source.scissorTest = this.sceneScale < 1;
    this.grade.uniforms.sourceScale.value.set(w / source.width, h / source.height);
    r.info.reset();
    r.setRenderTarget(source);
    r.render(this.scene, this.camera);
    this.stats.renderScale = this.sceneScale;
    this.stats.renderSamples = source.samples;
    this.stats.calls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
    if (this.gtao?.enabled) {
      this.gtao.render(r, this.aux, source, dt);
      source = this.aux;
    }
    if (this.bloom?.enabled) this.bloom.render(r, null, source, dt, false);
    this.grade.renderToScreen = !this.aa;
    const graded = source === this.aux ? this.sceneTarget : this.aux;
    this.grade.render(r, graded, source);
    if (this.aa) {
      this.aa.renderToScreen = true;
      this.aa.render(r, null, graded, dt);
    }
  }
}
