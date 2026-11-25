import * as THREE from 'three';

// The cardinal elevations are parallel projections. A separate perspective
// plate gives their ground and sky depth without tilting the measured facade.
function paving(renderer, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d'), pixels = g.createImageData(size, size);
  let seed = 209;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const u = x*512/size, v = y*512/size;
    const panelX = u >> 8, panelY = v >> 7;
    const joint = u % 256 < 2 || v % 128 < 2;
    const mottling = 2.3 * Math.cos((u+v)*2*Math.PI/128) + 1.8 * Math.sin(v*2*Math.PI/256);
    const value = 141 + mottling + 4 * Math.sin(3*panelX+2*panelY) + 20*(seed/4294967296-.5) - (joint ? 23 : 0);
    const i = (y*size+x)*4;
    pixels.data[i] = value+2; pixels.data[i+1] = value+1;
    pixels.data[i+2] = value; pixels.data[i+3] = 255;
  }
  g.putImageData(pixels,0,0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(600,600);
  map.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return map;
}

export function createElevationBackdrop(renderer, scene, lighting) {
  const plate = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .2, 9000);
  const dome = new THREE.Mesh(lighting.sky.geometry, lighting.sky.material);
  dome.scale.copy(lighting.sky.scale);
  const sun = new THREE.DirectionalLight(), fill = new THREE.HemisphereLight();
  plate.add(dome,sun,sun.target,fill);
  const direction = new THREE.Vector3(), grade = new THREE.Vector3();
  let floor, target, key = '';

  function clear() {
    if (!key) return;
    lighting.sky.visible = true;
    scene.background = null;
    target.dispose();
    target = null;
    key = '';
  }

  function update(rig, time, quality) {
    const ortho = rig.camera, canvas = renderer.domElement;
    const maxWidth = quality === 'low' ? 960 : quality === 'medium' ? 1440 : canvas.width;
    const scale = Math.min(1, maxWidth/canvas.width);
    const width = Math.round(canvas.width*scale), height = Math.max(1, Math.round(canvas.height*scale));
    const next = [rig.currentView, ortho.zoom, ortho.position.toArray(), ortho.projectionMatrix.elements,
      width, height, time, quality].join('|');
    if (key === next) return;
    key = next;
    if (!floor) {
      const map = paving(renderer, quality === 'low' ? 256 : 512);
      floor = new THREE.Mesh(new THREE.PlaneGeometry(3200,3200), new THREE.MeshStandardMaterial({map, roughness:.98}));
      floor.rotation.set(-Math.PI/2, 0, .14);
      plate.add(floor);
    }
    target ??= new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType});
    target.setSize(width,height);
    ortho.getWorldDirection(direction).setY(0).normalize();
    grade.copy(rig.controls.target).setY(0);
    const distance = ortho.top / ortho.zoom / Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    camera.position.copy(grade).addScaledVector(direction, -distance);
    camera.position.y = 7;
    camera.lookAt(grade);
    camera.aspect = canvas.width/canvas.height;
    camera.updateProjectionMatrix();
    grade.project(ortho);
    camera.projectionMatrix.elements[8] = -grade.x;
    camera.projectionMatrix.elements[9] = -grade.y;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    sun.position.copy(lighting.sun.position);
    sun.target.position.copy(lighting.sun.target.position);
    sun.color.copy(lighting.sun.color); sun.intensity = lighting.sun.intensity;
    fill.color.copy(lighting.hemi.color); fill.groundColor.copy(lighting.hemi.groundColor);
    fill.intensity = lighting.hemi.intensity;
    plate.environment = scene.environment;
    plate.environmentIntensity = scene.environmentIntensity;
    plate.fog ??= new THREE.FogExp2();
    plate.fog.color.copy(scene.fog.color);
    plate.fog.density = lighting.fogDensity;
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      renderer.render(plate,camera);
    } finally { renderer.setRenderTarget(previous); }
    lighting.sky.visible = false;
    scene.background = target.texture;
  }
  return {update, clear};
}
