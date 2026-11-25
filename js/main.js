// ============================================================================
//  CORE APP — Residential rooftop solar proposal
//  Creates renderer/scene/cameras/lighting/post, loads every builder module with
//  dynamic import() (each optional), wires the UI. See SPEC.md §3 / §4.1.
//  URL params: quality=high|medium|low, t=YYYY-MM-DDTHH:MM (IST), view=<preset>,
//              clean=1 (hide UI overlays), layers=-labels,+sunpath (toggle list)
// ============================================================================
import * as THREE from 'three';
import * as site from './site-data.js';
import { getSunPosition, getSunTimes, dateFromLocal, localParts } from './analysis/sun.js';
import { createRenderer, prepareColorMipmaps, PostFX, QUALITY, autoQuality } from './core/renderer.js';
import { Lighting } from './core/lighting.js';
import { SkyOcclusion } from './core/skyocc.js';
import { CameraRig, VIEWS, inverterView } from './core/cameras.js';
import { createElevationBackdrop } from './core/elevation.js';
import { createLabelRenderer, createSiteLabels, createCompass, createScaleBar } from './core/labels.js';
import { MeasureTool, raycastScene, takeScreenshot } from './core/tools.js';
import { createUI } from './core/ui.js';
import { installZoomGuard } from './core/zoomguard.js';
import { formatIN, fmtClock, fmtMinutes, fmtDateLong, escapeHtml } from './core/format.js';

// ---------------------------------------------------------------- errors
window.__errors = window.__errors || [];
window.__ready = false;
addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && (e.reason.stack || e.reason))));

const params = new URLSearchParams(location.search);
let frameCount = 0, renderUntil = 0, idleMode = false, lastFrameMs = 0;
const SITE = site.SITE;
const TIME_MIN = 330, TIME_MAX = 1140; // 05:30 – 19:00

const BUILDERS = [
  { key: 'environment', path: './env/index.js', fn: 'buildEnvironment', label: 'Ground, trees & surroundings', pct: 30 },
  { key: 'buildings', path: './buildings/index.js', fn: 'buildBuildings', label: 'Buildings, roofs & walls', pct: 50 },
  { key: 'structures', path: './structures/index.js', fn: 'buildStructures', label: 'Compound and entrances', pct: 64 },
  { key: 'solar', path: './solar/index.js', fn: 'buildSolar', label: `${site.LAYOUT.modules} modules and mounting`, pct: 82 },
  { key: 'sunpath', path: './analysis/sunpath.js', fn: 'createSunPath', label: 'Sun path', pct: 88 },
];

const summary = site.systemSummary();

boot().catch((e) => {
  console.error(e);
  window.__errors.push('boot: ' + (e.stack || e));
  const s = document.getElementById('ldStep');
  if (s) s.textContent = 'Could not start the 3D view: ' + (e.message || e);
});

async function boot() {
  mark('boot');
  // Fetch every builder module in parallel right away (they are still built one after another below).
  const modP = {};
  for (const b of BUILDERS) { modP[b.key] = import(b.path); modP[b.key].catch(() => {}); }
  const app = { results: {}, THREE };
  const handlers = {};
  const ui = createUI({ site, summary, views: VIEWS, handlers });
  ui.setLoading(4, 'Starting 3D engine…');
  const clean = params.get('clean') === '1';
  document.body.classList.toggle('clean', clean);
  document.body.classList.toggle('capture-labels', clean && params.get('labels') === '1');

  // ------------------------------------------------------------ renderer & scene
  const viewport = document.getElementById('viewport');
  const renderer = createRenderer(viewport);
  // Shadows are static unless the sun or the scene changes → re-render the shadow map only then
  // (the GTAO pass would otherwise re-render it a second time every frame).
  renderer.shadowMap.autoUpdate = false;
  const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; };
  shadowsDirty();
  let quality = params.get('quality');
  if (!QUALITY[quality]) { try { quality = localStorage.getItem('r2v.quality'); } catch (e) { quality = null; } }
  let autoQ = false; // quality picked automatically → may step down once if the device is too slow
  if (!QUALITY[quality] || (quality === 'ultra' && params.get('quality') !== 'ultra')) { quality = autoQuality(renderer); autoQ = true; }
  mark('renderer');
  const scene = new THREE.Scene();
  const rig = new CameraRig(renderer.domElement);
  // pinch / Ctrl+wheel / Ctrl± anywhere on the page zoom the 3D view only — never the page and its UI
  installZoomGuard({ target: renderer.domElement, onZoom: () => demandRender(600) });
  const lighting = new Lighting({ renderer, scene, quality });
  const post = new PostFX(renderer, scene, rig.camera, quality);
  const labelRenderer = createLabelRenderer(document.body);
  ui.setQuality(quality);

  let offsetCur = ui.panelOffsetPx(), offsetTarget = offsetCur;
  let offsetYCur = ui.panelOffsetY(), offsetYTarget = offsetYCur;
  // Adaptive resolution: while the view is moving on a slow (fill-rate-bound) GPU the frame is drawn
  // with fewer pixels (resScale < 1); as soon as it stops, the full-resolution still frame is drawn.
  let resScale = 1, motionScale = 1;
  let ambientSlow = false, lastWasAmbient = false; // ambient animation is skipped where full-res frames are expensive
  const basePixelRatio = () => Math.min(devicePixelRatio || 1, QUALITY[quality].pixelRatio);
  const minMotionScale = () => Math.min(1, 0.6 / basePixelRatio());
  function setResScale(sc) {
    if (Math.abs(sc - resScale) < 0.02) return;
    resScale = sc; post.setSize(innerWidth, innerHeight, basePixelRatio() * sc);
    demandRender(300); // resizing clears the canvas → draw this tick
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    post.setSize(w, h, basePixelRatio() * resScale);
    offsetTarget = ui.panelOffsetPx(); offsetYTarget = ui.panelOffsetY();
    rig.setSize(w, h, offsetCur, offsetYCur);
    labelRenderer.setSize(w, h);
  }
  resize();
  addEventListener('resize', resize);
  handlers.onPanelChange = () => { offsetTarget = ui.panelOffsetPx(); offsetYTarget = ui.panelOffsetY(); };

  // ------------------------------------------------------------ ctx (SPEC §3)
  const occluders = [];
  const animated = [];
  const sunSubs = [];
  const ctx = {
    THREE, scene, renderer, site,
    get camera() { return rig.camera; },
    quality: quality === 'ultra' ? 'high' : quality,
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    registerOccluder: (m) => { if (m && !occluders.includes(m)) occluders.push(m); },
    registerAnimated: (fn) => { if (typeof fn === 'function') animated.push(fn); },
    sunState: { azimuth: 0, elevation: 0, dirWorld: new THREE.Vector3(0, 1, 0), date: new Date() },
    onSunChange: (fn) => { if (typeof fn === 'function') sunSubs.push(fn); },
  };

  // ------------------------------------------------------------ time state
  const T = initialTime();
  let satOk = null, sunpathSubscribed = false;
  let playing = false, speed = 30; // simulated minutes per second
  function applySun(notify = true) {
    const hh = Math.floor(T.min / 60), mm = Math.round(T.min % 60);
    const date = dateFromLocal(T.y, T.m, T.d, hh, mm, SITE.utcOffsetHours);
    const sp = getSunPosition(date, SITE.lat, SITE.lng);
    lighting.setSun(sp.azimuth, sp.elevation);
    post.setGrade(lighting.golden * (1 - lighting.night), lighting.dusk, lighting.night * (1 - lighting.dusk));
    demandRender(800); shadowsDirty();
    const S = ctx.sunState;
    S.azimuth = sp.azimuth; S.elevation = sp.elevation; S.date = date;
    S.dirWorld.copy(lighting.sunDir);
    S.night = lighting.night; S.dusk = lighting.dusk; S.lightsOn = lighting.lightsOn;
    ctx.night = lighting.night; ctx.lightsOn = lighting.lightsOn;
    const times = getSunTimes(date, SITE.lat, SITE.lng, SITE.utcOffsetHours);
    const dl = times.dayLengthHours;
    ui.setSunReadout({
      azimuth: sp.azimuth, elevation: sp.elevation,
      sunrise: fmtClock(times.sunrise), sunset: fmtClock(times.sunset), noon: fmtClock(times.solarNoon),
      dayLength: `${Math.floor(dl)}h ${String(Math.round((dl % 1) * 60)).padStart(2, '0')}m`,
      dateLabel: fmtDateLong(T.y, T.m, T.d), timeLabel: fmtMinutes(T.min),
    });
    ui.setTime(Math.round(T.min / 5) * 5);
    if (notify) {
      for (const fn of sunSubs) { try { fn(S); } catch (e) { reportOnce('onSunChange', e); } }
      // the sun-path module subscribes to onSunChange itself; only drive it explicitly if it did not
      const sp2 = app.results.sunpath; if (sp2 && sp2.update && !sunpathSubscribed) { try { sp2.update(date); } catch (e) { reportOnce('sunpath.update', e); } }

    }
  }
  ui.setDate(T.y, T.m, T.d);
  applySun(false);
  mark('lighting');

  // ------------------------------------------------------------ load builders
  for (const [bi, b] of BUILDERS.entries()) {
    ui.setLoading(b.pct - 14, `Step ${bi + 1} of ${BUILDERS.length + 1} · Building ${b.label}…`);
    await nextFrame(); // let the bar & label paint before the builder blocks the thread
    try {
      const t0 = performance.now();
      const mod = await modP[b.key];
      mark('fetched:' + b.key);
      if (typeof mod[b.fn] !== 'function') throw new Error(`${b.path} has no export ${b.fn}()`);
      const nSubs = sunSubs.length;
      const res = await mod[b.fn](ctx);
      if (b.key === 'sunpath' && sunSubs.length > nSubs) sunpathSubscribed = true;
      if (res && res.group) scene.add(res.group);
      app.results[b.key] = res || {};
      mark('built:' + b.key);
      console.log(`[app] ${b.key} built in ${(performance.now() - t0).toFixed(0)} ms`);
    } catch (e) {
      app.results[b.key] = null;
      const missing = /Failed to fetch|error loading dynamically imported module|Importing a module script failed|404/i.test(String(e && e.message));
      console.warn(`[app] ${b.key} unavailable:`, e);
      window.__errors.push(`${b.key}: ${e && (e.stack || e)}`);
      ui.toast(`${b.label}: module ${missing ? 'not available yet' : 'failed to load'} — continuing without it.`, 'warn', 6000);
    }
    ui.setLoading(b.pct, `${b.label} ✓`);
  }
  const R = app.results;
  if (!R.environment) scene.add(makeFallbackGround());
  // satellite imagery downloads while the other builders run; give it a little longer so the first
  // frames already show it (otherwise it pops in when ready)
  if (R.environment && R.environment.satellite && R.environment.satellite.then) {
    ui.setLoading(90, 'Loading satellite imagery…');
    await Promise.race([R.environment.satellite.catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
    mark('satellite');
  }

  prepareColorMipmaps(scene);
  // Covered-area sky occlusion for balconies, courtyards and under-panel shadows.
  let skyOcc = null;
  try { skyOcc = new SkyOcclusion(renderer, scene, quality); skyOcc.patchScene(); skyOcc.update(); } catch (e) { reportOnce('skyocc', e); skyOcc = null; }
  mark('skyocc');
  const refreshSkyOcc = () => { shadowsDirty(); if (!skyOcc) return; try { skyOcc.patchScene(); skyOcc.update(); demandRender(1200); } catch (e) { reportOnce('skyocc.update', e); } };
  app.skyOcc = skyOcc;
  // Update the indirect lighting when the satellite materials finish loading.
  if (R.environment && R.environment.satellite && R.environment.satellite.then) {
    R.environment.satellite.then((s) => { refreshSkyOcc(); satOk = !!(s && s.ok); updateAttribution(); demandRender(1500); }).catch(() => { satOk = false; updateAttribution(); });
  }

  // The analysis bundle is optional and loaded locally.
  let shadingMod = null;
  const shadingP = import('./analysis/shading.js')
    .then((m) => { shadingMod = typeof m.createShadingAnalyzer === 'function' ? m : null; })
    .catch((e) => { shadingMod = null; console.warn('[app] shading.js unavailable', e); })
    .then(() => ui.shade.setAvailable(!!shadingMod));


  // ------------------------------------------------------------ labels, compass, scale bar
  const labels = createSiteLabels(site, label => {
    if (label.block) handlers.onView('block' + label.block);
    else if (label.kind === 'equipment') {
      const station = site.INVERTER_STATIONS.find(st => st.id === label.id);
      const view = inverterView(station);
      app.lookAt(view.cam, view.target, view.fov);
    } else handlers.onView('road');
  });
  scene.add(labels.group);
  const compass = createCompass(document.getElementById('compass'), () => handlers.onView('top'));
  const scaleBar = createScaleBar(document.getElementById('scalebar'));
  const measure = new MeasureTool(scene);

  // ------------------------------------------------------------ layers
  const layerAvail = {
    modules: !!(R.solar && R.solar.setVisible), strings: !!(R.solar && R.solar.setColorMode),
    labels: true, satellite: !!(R.environment && R.environment.setSatelliteVisible),
    vegetation: !!(R.environment && R.environment.setVegetationVisible),
    context: !!(R.structures?.setContextVisible || R.environment?.setContextVisible),
    vehicles: !!(R.environment && R.environment.setVehiclesVisible),
    sunpath: !!(R.sunpath && R.sunpath.group), shadows: true, compass: true,
  };
  for (const [k, ok] of Object.entries(layerAvail)) ui.setLayerAvailable(k, ok);
  let colorMode = 'normal';
  let heatValues = null, shadeLegendSub = '';
  function setColorMode(mode) {
    if (!['normal','strings','inverters','heatmap'].includes(mode)) return false;
    if (mode === 'heatmap' && !heatValues) {
      ui.setColorMode(colorMode, ui.layerState('modules'));
      ui.setCollapsed(false); ui.setTab('sun');
      ui.toast('Analyse a day or the full year to colour modules by shading.', 'info');
      return false;
    }
    colorMode = mode;
    R.solar?.setColorMode?.(mode, mode === 'heatmap' ? heatValues : undefined);
    const visible = ui.layerState('modules');
    ui.setColorMode(mode, visible);
    if (mode === 'heatmap' && visible) ui.showHeatLegend('Beam shading per module', shadeLegendSub, heatLegendOpts());
    demandRender(600);
    return true;
  }
  handlers.onColorMode = setColorMode;
  function applyLayer(name, on) {
    demandRender(1500); shadowsDirty();
    try {
      switch (name) {
        case 'modules':
          R.solar?.setVisible?.(on);
          labels.setSolarVisible(on);
          ui.setLayer(name, on);
          setColorMode(colorMode);
          ui.hideTooltip(); ui.hideCard();
          break;
        case 'strings': return setColorMode(on ? 'strings' : 'normal');
        case 'context':
          R.environment?.setContextVisible?.(on);
          R.structures?.setContextVisible?.(on);
          break;
        case 'labels': labels.setVisible(on); break;
        case 'satellite': R.environment && R.environment.setSatelliteVisible && R.environment.setSatelliteVisible(on); updateAttribution(); break;
        case 'vegetation': R.environment && R.environment.setVegetationVisible && R.environment.setVegetationVisible(on); break;
        case 'vehicles': R.environment && R.environment.setVehiclesVisible && R.environment.setVehiclesVisible(on); break;
        case 'sunpath':
          if (R.sunpath) { if (R.sunpath.setVisible) R.sunpath.setVisible(on); else if (R.sunpath.group) R.sunpath.group.visible = on; if (on && R.sunpath.update) R.sunpath.update(ctx.sunState.date); }
          break;
        case 'shadows': lighting.setShadowsEnabled(on); break;
        case 'compass':
          document.getElementById('compass').style.display = on ? '' : 'none';
          document.getElementById('scalebar').style.display = on ? '' : 'none';
          break;
        default: return false;
      }
      if (['modules', 'context', 'satellite', 'vegetation', 'vehicles'].includes(name)) refreshSkyOcc();
    } catch (e) { reportOnce('layer ' + name, e); }
    return true;
  }
  handlers.onLayer = (name, on) => applyLayer(name, on);
  // URL layer overrides: layers=-labels,+sunpath
  for (const tok of (params.get('layers') || '').split(',').filter(Boolean)) {
    const on = !tok.startsWith('-'); const name = tok.trim().replace(/^[-+]/, '');
    ui.setLayer(name, on);
  }
  if (clean || params.has('labels')) ui.setLayer('labels', params.get('labels') === '1');
  for (const k of Object.keys(layerAvail)) {
    const on = ui.layerState(k);
    if (!layerAvail[k]) { if (k === 'strings' || k === 'sunpath') ui.setLayer(k, false); continue; }
    if (on && ['shadows', 'modules', 'context', 'satellite', 'vegetation', 'vehicles'].includes(k)) continue; // already the builders' default
    applyLayer(k, on);
  }
  function updateAttribution() {
    const env = R.environment;
    const sat = env && env.attribution && satOk !== false && ui.layerState('satellite');
    ui.setAttribution(`${sat ? env.attribution + ' · ' : ''}Indicative site model · ${site.PROJECT.preparedBy}`);
  }
  updateAttribution();

  // ------------------------------------------------------------ views & camera
  rig.on((type, v) => {
    if (type === 'view') ui.setActiveView(v);
    if (type === 'mode') ui.setMode(v);
    if (type === 'drone') ui.setDrone(v);
  });
  handlers.onView = (name) => { if (!VIEWS[name]) return Promise.resolve(false); ui.hideCard(); return rig.flyTo(name); };
  handlers.onMode = (mode) => {
    const m = mode === 'toggle' ? (rig.mode === 'ortho' ? 'persp' : 'ortho') : mode;
    rig.cancelAnim(); rig.setMode(m);
    if (rig.ortho.near !== 1 || rig.ortho.far !== 4000) { rig.ortho.near = 1; rig.ortho.far = 4000; rig.ortho.updateProjectionMatrix(); }
    post.setCamera(rig.camera);
  };
  handlers.onReset = () => { rig.stopDrone(); measureOff(); ui.hideCard(); return rig.flyTo('overview'); };

  // ------------------------------------------------------------ sun controls
  handlers.onDate = (y, m, d) => { T.y = y; T.m = m; T.d = d; ui.setDate(y, m, d); applySun(); };
  handlers.onTime = (min) => { T.min = min; applySun(); };
  handlers.onQuickDate = (m, d, hour) => { T.min = hour * 60; handlers.onDate(T.y, m, d); };
  handlers.onPlay = () => { playing = !playing; ui.setPlaying(playing); if (playing && (T.min >= TIME_MAX - 5)) T.min = TIME_MIN; };
  handlers.onSpeed = (v) => { speed = v; };
  handlers.onNow = () => {
    const p = localParts(new Date(), SITE.utcOffsetHours);
    T.y = p.year; T.m = p.month; T.d = p.day; T.min = p.hour * 60 + p.minute;
    ui.setDate(T.y, T.m, T.d); applySun();
  };

  // ------------------------------------------------------------ shade analysis
  let analyzer = null, shadeRunning = false;
  const allModules = (R.solar && R.solar.modules) || site.computeLayout();
  handlers.onShade = async (kind) => {
    if (!shadingMod) await shadingP;
    if (!shadingMod) { ui.toast('The local shading analysis module is unavailable.', 'warn'); return; }
    if (shadeRunning) return;
    shadeRunning = true;
    const dateLabel = fmtDateLong(T.y, T.m, T.d);
    ui.shade.start(kind, dateLabel);
    try {
      if (!analyzer) analyzer = await shadingMod.createShadingAnalyzer(ctx, { modules: allModules, occluders: () => occluders, moduleMesh: (R.solar && R.solar.moduleMesh) || null });
      const onP = (p) => { ui.shade.progress(Math.max(0, Math.min(1, +p || 0))); };
      const res = kind === 'year' ? await analyzer.runYear({year: T.y}, onP) : await analyzer.runDay({ year: T.y, month: T.m, day: T.d }, {}, onP);
      if (!res || res.cancelled) { ui.toast('Shade analysis cancelled.', 'info'); return; }
      res.kind = kind; res.dateLabel = dateLabel;
      app.results.shading = res;
      if (kind === 'year') { app.results.shadingYear = res; app.results.shadingYearEnergy = null; }
      showShadeResult(res);
      ui.toast(`Shade analysis complete — array shading loss ${(+res.arrayLossPct).toFixed(2)} %.`, 'ok');
    } catch (e) {
      if (e && /cancel/i.test(String(e.message || e))) ui.toast('Shade analysis cancelled.', 'info');
      else { console.error(e); window.__errors.push('shading: ' + (e && (e.stack || e))); ui.toast('Shade analysis failed: ' + (e && e.message || e), 'error', 7000); }
    } finally { shadeRunning = false; ui.shade.end(); }
  };
  handlers.onShadeCancel = () => { try { analyzer && analyzer.cancel && analyzer.cancel(); } catch (e) { /* ignore */ } };
  handlers.onShadeClear = () => {
    heatValues = null; app.results.shading = null; ui.shade.clear(); ui.hideLegend();
    setColorMode('normal');
  };
  handlers.onModuleFocus = (index) => {
    const m = allModules[index]; if (!m) return;
    const c = m.center; rig.focusOn(new THREE.Vector3(c[0], c[2], -c[1]), 16);
    try { R.solar && R.solar.highlight && R.solar.highlight(index); } catch (e) { /* ignore */ }
    pinnedModule = index;
  };

  function heatLegendOpts() {
    try {
      const S = R.solar;
      if (!S || typeof S.heatTicks !== 'function') return {};
      return { ticks: S.heatTicks(), colors: typeof S.heatColorCss === 'function' ? [0, 0.25, 0.5, 0.75, 1].map((t) => S.heatColorCss(t)) : null };
    } catch (e) { return {}; }
  }
  function showShadeResult(res) {
    const per = res.perModule || new Float32Array(allModules.length);
    heatValues = per;
    shadeLegendSub = res.kind === 'year' ? 'Full year' : res.dateLabel;
    setColorMode('heatmap');
    // per-plane loss (%), fall back to module means
    let pl = res.perPlaneLossPct instanceof Map ? Object.fromEntries(res.perPlaneLossPct) : (res.perPlaneLossPct || null);
    const counts = {};
    allModules.forEach((m, i) => { const c = counts[m.plane] || (counts[m.plane] = { n: 0, s: 0 }); c.n++; c.s += per[i] || 0; });
    if (!pl || !Object.keys(pl).length) { pl = {}; for (const [p, c] of Object.entries(counts)) pl[p] = 100 * c.s / c.n; }
    const arrayLoss = Number.isFinite(+res.arrayLossPct) ? +res.arrayLossPct : 0;
    const adjustedAnnual = loss => site.PVGIS.S.annual * summary.kwp * (1 - loss / 100);
    const energy = {annual: adjustedAnnual(arrayLoss)};
    const isYear = res.kind === 'year';
    // annual energy: only ever presented as a bankable KPI from a full-year run
    const yearRes = app.results.shadingYear;
    let yearEnergy = null;
    if (isYear) yearEnergy = energy;
    else if (yearRes) yearEnergy = app.results.shadingYearEnergy || (app.results.shadingYearEnergy = {annual: adjustedAnnual(yearRes.arrayLossPct)});
    const hourly = Array.isArray(res.hourly) ? res.hourly.filter((h) => h && Number.isFinite(+h.poaWhm2)) : [];
    const poaDay = hourly.reduce((a, h) => a + (+h.poaWhm2 || 0), 0) / 1000;
    const lostDay = hourly.reduce((a, h) => a + (+h.lostWhm2 || 0), 0) / 1000;
    const kpi2 = isYear
      ? `<div class="kpi"><div class="v">${summary.systemLossPct}<small>%</small></div><div class="k">System-loss allowance that already covers this shading</div></div>`
      : hourly.length
        ? `<div class="kpi"><div class="v">${lostDay.toFixed(2)}<small>kWh/m²</small></div><div class="k">Beam lost of ${poaDay.toFixed(2)} kWh/m² that day</div></div>`
        : `<div class="kpi"><div class="v">${res.dateLabel ? escapeHtml(res.dateLabel.split(',')[0]) : '—'}</div><div class="k">Single-day run</div></div>`;
    const maxL = Math.max(1, ...hourly.map((h) => +h.lossPct || 0));
    const profile = !isYear && hourly.length ? `
      <h2 class="sec">Hourly loss · ${escapeHtml(res.dateLabel)}</h2>
      <div class="hprof">${hourly.map((h) => { const v = +h.lossPct || 0; return `<div class="hb" title="${escapeHtml(String(h.label || h.hour))}: ${v.toFixed(1)} % loss"><i style="height:${Math.max(2, 100 * v / maxL).toFixed(0)}%"></i><span>${escapeHtml(String(h.label != null ? h.label : h.hour)).replace(/:00$/, '')}</span></div>`; }).join('')}</div>` : '';
    const annualBox = isYear ? '' : yearEnergy
      ? `<div class="kpi" style="margin-top:8px"><div class="v">${(+yearRes.arrayLossPct).toFixed(2)}<small>%</small></div><div class="k">Full-year shading loss · inside the ${summary.systemLossPct} % system-loss allowance</div></div>`
      : `<div class="callout warn">One day is not representative of the year (sun path changes by ±23°). For the annual shading loss <b>run the full-year analysis</b>.
         <div class="row" style="margin-top:6px"><button class="btn sm grow" id="shadeYearNow">Run full year</button></div></div>`;
    const worst = (res.worst || []).slice(0, 6);
    // Trees: how much of the headline loss is vegetation (modelled estimates) — always disclosed next to the KPIs
    const veg = res.vegetation && Number.isFinite(+res.vegetation.lossPct) ? res.vegetation : null;
    const disc = res.disclosure && Array.isArray(res.disclosure.lines) ? res.disclosure.lines : [];
    const vegPlane = veg && veg.perPlaneLossPct ? (veg.perPlaneLossPct instanceof Map ? Object.fromEntries(veg.perPlaneLossPct) : veg.perPlaneLossPct) : null;
    let vegBox = '';
    if (veg) {
      const without = Math.max(0, +veg.lossWithoutPct || 0);
      const share = Math.max(0, Math.min(100, +veg.sharePct || 0));
      // energy without trees: same model, scaled by the loss ratio (≈, per-plane mix kept)
      const eWith = isYear ? energy.annual : (yearEnergy ? yearEnergy.annual : null);
      const lossRef = isYear ? arrayLoss : (yearRes ? +yearRes.arrayLossPct || 0 : null);
      const yv = isYear ? veg : (yearRes && yearRes.vegetation) || null;
      const eWithout = eWith && yv && lossRef != null && lossRef < 100 ? eWith * (1 - (+yv.lossWithoutPct || 0) / 100) / (1 - lossRef / 100) : null;
      vegBox = `<div class="veg-split">
        <div class="vs-bar" title="Share of the shading loss caused by trees"><i style="width:${share.toFixed(1)}%"></i></div>
        <div class="vs-txt"><b>${share.toFixed(0)} %</b> of this loss is caused by trees (modelled canopy shading).
          Without trees: <b>${without.toFixed(2)} %</b>${eWithout ? ` · <b>${formatIN(Math.round(eWithout))} kWh</b>/yr` : ''} — buildings and rooftop equipment alone.</div>
      </div>`;
    }
    const discBox = disc.length ? `<details class="disc"${veg ? '' : ' open'}><summary>What this analysis counts</summary><ul>${disc.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul></details>` : '';
    const html = `
      <div class="result-hero">
        <div class="kpi"><div class="v">${arrayLoss.toFixed(2)}<small>%</small></div><div class="k">Array shading loss${res.kind === 'year' ? ' (year)' : ` (${escapeHtml(res.dateLabel)})`}</div></div>
        ${kpi2}
      </div>
      ${vegBox}
      ${discBox}
      ${annualBox}
      <h2 class="sec">Shading loss by block</h2>
      <table class="tbl"><thead><tr><th>Wing</th><th class="num">Modules</th><th class="num">Loss</th>${vegPlane ? '<th class="num">Trees</th>' : ''}</tr></thead><tbody>
      ${Object.entries(counts).sort(([a],[b]) => a.localeCompare(b)).map(([p,c]) => `<tr><td>${escapeHtml(site.BLOCKS[p].short)}</td><td class="num">${c.n}</td><td class="num">${(+pl[p] || 0).toFixed(2)}%</td>${vegPlane ? `<td class="num">${(+vegPlane[p] || 0).toFixed(2)}%</td>` : ''}</tr>`).join('')}
      </tbody></table>
      ${profile}
      ${worst.length ? `<h2 class="sec">Most shaded modules</h2><ul class="worst">${worst.map((w) => {
        const m = allModules[w.index] || {};
        return `<li data-mod="${w.index}"><b>${escapeHtml(w.id || m.id || '#' + w.index)}</b><span>${escapeHtml(m.string || '')} · ${(+w.pct).toFixed(1)} %</span></li>`;
      }).join('')}</ul>` : ''}
      <p class="note">${res.kind === 'year'
        ? `The simulated shading loss sits inside the ${summary.systemLossPct} % system-loss allowance behind the Year-1 generation figure. It is not deducted a second time.`
        : 'This browser simulation covers the selected day. Choose a full-year run for the annual simulation.'}
        ${res.timing && (res.timing.totalMs || res.timing.ms) ? ` Computed in ${((res.timing.totalMs || res.timing.ms) / 1000).toFixed(1)} s.` : ''}</p>
      <div class="row" style="margin-top:8px"><button class="btn sm grow" id="shadeClear">Clear heatmap</button></div>`;
    ui.shade.showResult(html);
    const yb = document.getElementById('shadeYearNow');
    if (yb) yb.addEventListener('click', () => handlers.onShade('year'));
  }

  // ------------------------------------------------------------ picking: tooltip, cards, measure
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ptr = { x: 0, y: 0, inside: false, dirty: false, down: null, lastHover: 0 };
  let hoverIndex = null, pinnedModule = null, measuring = false;
  const canvas = renderer.domElement;
  function setRay(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, rig.camera);
  }
  canvas.addEventListener('pointermove', (e) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.inside = true; ptr.dirty = true; ptr.type = e.pointerType; });
  canvas.addEventListener('pointerleave', () => { ptr.inside = false; clearHover(); });
  canvas.addEventListener('pointerdown', (e) => { ptr.down = { x: e.clientX, y: e.clientY, t: performance.now() }; clearHover(); });
  canvas.addEventListener('pointerup', (e) => {
    const d = ptr.down; ptr.down = null;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    onClick(e.clientX, e.clientY, e.pointerType);
  });
  function clearHover() {
    if (hoverIndex !== null) { hoverIndex = null; ui.hideTooltip(); viewport.classList.remove('hovering'); try { R.solar && R.solar.highlight && R.solar.highlight(pinnedModule); } catch (e) { /* */ } }
  }
  function pickModule() {
    if (!R.solar || !R.solar.pick || !ui.layerState('modules')) return null;
    try { const i = R.solar.pick(raycaster); return Number.isInteger(i) ? i : null; } catch (e) { reportOnce('solar.pick', e); return null; }
  }
  function moduleHtml(i) {
    let info = null;
    try { info = R.solar.info ? R.solar.info(i) : null; } catch (e) { info = null; }
    const m = allModules[i] || {};
    info = { ...m, ...info };
    const block = site.BLOCKS[info.block || info.plane];
    const col = site.STRING_COLORS[m.stringIndex] || '#888';
    const dims = [site.MODULE.length, site.MODULE.width, site.MODULE.thickness].map(v => Math.round(v * 1000)).join(' × ');
    return `<div class="tt-h"><i class="swatch" style="background:${col}"></i>${escapeHtml(info.id)}</div>
      <dl><dt>String / inverter</dt><dd>${escapeHtml(info.string)} / ${escapeHtml(info.inverter)}</dd>
      <dt>Wing / table</dt><dd>${escapeHtml(block.short)} / ${escapeHtml(info.table)}</dd>
      <dt>Orientation</dt><dd>${info.tiltDeg}° tilt · south (${info.azimuthDeg}°)</dd>
      <dt>Module</dt><dd>${info.wp} Wp</dd><dt>Dimensions</dt><dd>${dims} mm</dd>
      ${heatValues ? `<dt>Beam shading</dt><dd>${(100 * heatValues[i]).toFixed(1)}%</dd>` : ''}</dl>`;
  }
  function updateHover(now) {
    if (!ptr.dirty || !ptr.inside || ptr.down || rig.anim || measuring || ptr.type === 'touch') return;
    if (now - ptr.lastHover < 60) return;
    ptr.dirty = false; ptr.lastHover = now;
    setRay(ptr.x, ptr.y);
    const i = pickModule();
    if (i === null) { clearHover(); return; }
    if (i !== hoverIndex) {
      hoverIndex = i; demandRender(600);
      try { R.solar.highlight && R.solar.highlight(i); } catch (e) { /* */ }
      viewport.classList.add('hovering');
    }
    ui.showTooltip(ptr.x, ptr.y, moduleHtml(i));
  }
  let lastGhost = 0;
  function updateMeasureGhost(now) {
    if (!measuring || !measure.pending || !ptr.dirty || ptr.down || now - lastGhost < 110) return;
    lastGhost = now; ptr.dirty = false;
    setRay(ptr.x, ptr.y);
    const h = pickSurface();
    measure.updateGhost(h ? h.point : null);
  }
  function pickSurface() {
    const roots = [R.solar && R.solar.group, R.buildings && R.buildings.group, R.structures && R.structures.group, R.environment && R.environment.group, scene.getObjectByName('fallback-ground')].filter(Boolean);
    const hits = raycastScene(raycaster, roots);
    return hits[0] || null;
  }
  function onClick(x, y, pointerType) {
    setRay(x, y);
    if (measuring) {
      const h = pickSurface();
      if (!h) { ui.toast('No surface there — click on a roof, wall or the ground.', 'info', 2500); return; }
      const r = measure.addPoint(h.point); demandRender(1000);
      if (r) ui.toast(`Distance ${r.dist.toFixed(2)} m (${(r.dist / 0.3048).toFixed(1)} ft)`, 'ok', 3000);
      return;
    }
    const mi = pickModule();
    const buildingHit = R.buildings?.group && raycastScene(raycaster, [R.buildings.group])[0];
    // A roof array can project behind a nearer balcony or stair headroom in an eye-level view.
    let moduleInFront = mi !== null;
    if (moduleInFront && buildingHit) {
      const m = allModules[mi], plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        site.planToWorld(THREE, ...m.n), site.planToWorld(THREE, ...m.center));
      const moduleDistance = raycaster.ray.distanceToPlane(plane);
      moduleInFront = moduleDistance !== null && moduleDistance <= buildingHit.distance + .025;
    }
    if (moduleInFront) {
      pinnedModule = mi;
      try { R.solar.highlight && R.solar.highlight(mi); } catch (e) { /* */ }
      ui.hideTooltip();
      ui.showCard(`<h3>PV module ${escapeHtml(allModules[mi].id)}</h3><div class="ic-sub">${escapeHtml(site.MODULE.model)}</div>${moduleHtml(mi).replace(/<div class="tt-h">.*?<\/div>/,'')}`);
      return;
    }
    const bKey = buildingHit && site.blockOf(buildingHit.point.x, -buildingHit.point.z);
    if (bKey) { showBuildingCard(bKey); return; }
    if (ui.cardOpen()) ui.hideCard();
    if (pointerType === 'touch') ui.hideTooltip();
  }
  handlers.onCardClose = () => {
    pinnedModule = null;
    try { R.solar && R.solar.highlight && R.solar.highlight(null); } catch (e) { /* */ }
  };
  function showBuildingCard(key) {
    const b = site.BLOCKS[key], data = summary.perBlock[key];
    ui.showCard(`<h3>${escapeHtml(b.name)}</h3><dl><dt>Modules</dt><dd>${data.modules}</dd>
      <dt>Installed capacity</dt><dd>${data.kwp.toFixed(2)} kWp</dd></dl>
      <button class="btn sm" data-view="block${key}">View wing</button>`);
  }
  function measureOn() {
    measuring = true; ui.setMeasureActive(true); viewport.classList.add('measuring'); clearHover(); ui.hideCard();
  }
  function measureOff() {
    measuring = false; measure.cancelPending(); ui.setMeasureActive(false); viewport.classList.remove('measuring');
  }
  handlers.onMeasure = (force) => { const on = typeof force === 'boolean' ? force : !measuring; if (on) measureOn(); else measureOff(); };
  handlers.onMeasureClear = () => { measure.clear(); };

  // ------------------------------------------------------------ tools
  handlers.onScreenshot = async () => {
    try {
      const stamp = `${T.y}-${String(T.m).padStart(2, '0')}-${String(T.d).padStart(2, '0')}_${fmtMinutes(T.min).replace(':', '')}`;
      const r = await takeScreenshot({
        renderer, post, rig,
        labelObjs: ui.layerState('labels') ? labels.items : [],
        caption: clean ? null : { left: `${site.PROJECT.customer} · ${summary.kwp.toFixed(2)} kWp Rooftop Solar PV · ${fmtDateLong(T.y, T.m, T.d)} ${fmtMinutes(T.min)} IST`, right: `Prepared by ${site.PROJECT.preparedBy}` },
        filename: `${site.BUILDING.name}_${summary.kwp.toFixed(2)}kWp_${stamp}.png`,
      });
      ui.toast(`Screenshot saved (${r.width} × ${r.height}).`, 'ok');
    } catch (e) { ui.toast('Screenshot failed: ' + (e.message || e), 'error'); }
  };
  handlers.onFullscreen = () => {
    const d = document;
    if (!d.fullscreenElement) (d.documentElement.requestFullscreen ? d.documentElement.requestFullscreen() : Promise.reject(new Error('unsupported'))).catch(() => ui.toast('Fullscreen is not available here.', 'info'));
    else d.exitFullscreen();
  };
  function setQuality(q, persist = true) {
    if (!QUALITY[q] || (q === 'ultra' && params.get('quality') !== 'ultra')) return;
    quality = q; ctx.quality = q === 'ultra' ? 'high' : q;
    R.environment?.setQuality?.(ctx.quality);
    refreshSkyOcc();
    post.setQuality(q);
    lighting.setShadowMapSize(QUALITY[q].shadow);
    shadowsDirty(); demandRender(1500);
    motionScale = 1; resScale = 1; ambientSlow = false;
    resize();
    ui.setQuality(q);
    if (persist) { autoQ = false; try { localStorage.setItem('r2v.quality', q); } catch (e) { /* ignore */ } }
  }
  handlers.onQuality = (q) => { setQuality(q); ui.toast(`Render quality: ${QUALITY[q].label}`, 'info', 2000); };

  // ------------------------------------------------------------ keyboard
  addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag) && e.key !== 'Escape') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const byKey = Object.entries(VIEWS).find(([, v]) => v.key === k);
    if (byKey) { handlers.onView(byKey[0]); e.preventDefault(); return; }
    switch (k.toLowerCase()) {
      case 'b': applyLayer('modules', !ui.layerState('modules')); break;
      case 'o': handlers.onMode('toggle'); break;
      case ' ': handlers.onPlay(); e.preventDefault(); break;
      case 'm': handlers.onMeasure(); break;
      case 'l': { const on = !ui.layerState('labels'); ui.setLayer('labels', on); applyLayer('labels', on); break; }
      case 'f': handlers.onFullscreen(); break;
      case 'r': handlers.onReset(); break;
      case 'p': handlers.onScreenshot(); break;
      case 'h': ui.togglePanel(); break;
      case 'escape':
        if (measuring) { if (measure.pending) measure.cancelPending(); else measureOff(); }
        else if (ui.cardOpen()) ui.hideCard();
        else if (shadeRunning) handlers.onShadeCancel();
        break;
      default: return;
    }
  });

  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); ui.toast('Graphics context lost — please reload the page.', 'error', 10000); });

  // ------------------------------------------------------------ public API
  const waitFrames = (n = 2) => new Promise((res) => { const target = frameCount + n; const chk = () => { if (frameCount >= target) res(true); else { demandRender(500); requestAnimationFrame(chk); } }; chk(); });
  Object.assign(app, {
    scene, renderer, controls: rig.controls, rig, lighting, post, ctx, ui, occluders, animated,
    setColorMode,
    setSolarVisible(on) { return applyLayer('modules', !!on); },
    views: Object.keys(VIEWS),
    async setView(name, opts = {}) {
      if (!VIEWS[name]) throw new Error('Unknown view ' + name + '. Views: ' + Object.keys(VIEWS).join(', '));
      ui.hideCard();
      const p = rig.flyTo(name, opts);
      await p; post.setCamera(rig.camera);
      await waitFrames(2);
      return name;
    },
    async setTime(isoLocal) {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(isoLocal));
      if (!m) throw new Error('setTime expects "YYYY-MM-DDTHH:MM" (IST)');
      T.y = +m[1]; T.m = +m[2]; T.d = +m[3]; if (m[4] !== undefined) T.min = +m[4] * 60 + +m[5];
      ui.setDate(T.y, T.m, T.d); applySun();
      lighting.update(performance.now(), true);
      await waitFrames(2);
      return { azimuth: ctx.sunState.azimuth, elevation: ctx.sunState.elevation };
    },
    /** Free camera for reviews/tests: cam & target in PLAN coords [x east, y north, z up]. */
    async lookAt(cam, target, fov) {
      if (rig.mode !== 'persp') handlers.onMode('persp');
      try { rig.cancelAnim && rig.cancelAnim(); rig.stopDrone && rig.stopDrone(); } catch (e) { /* ignore */ }
      const c = rig.camera;
      c.position.set(cam[0], cam[2], -cam[1]);
      rig.controls.target.set(target[0], target[2], -target[1]);
      if (fov) { c.fov = fov; c.updateProjectionMatrix(); }
      rig.controls.update(); post.setCamera(rig.camera);
      await waitFrames(2);
      return true;
    },
    setQuality(q) { setQuality(q); return quality; },
    setLayer(name, on) { ui.setLayer(name, !!on); return applyLayer(name, !!on); },
    setMode(mode) { handlers.onMode(mode); return rig.mode; },
    setPanel(open) { ui.setCollapsed(!open); },
    runShade(kind = 'day') { return handlers.onShade(kind); },
    measure, stats: () => ({ ...post.stats, quality, occluders: occluders.length, animated: animated.length, frameMs: +lastFrameMs.toFixed(1), idleMode, mode: rig.mode, view: rig.currentView }),
    invalidate: (ms = 1000) => { shadowsDirty(); demandRender(ms); },
  });
  Object.defineProperty(app, 'camera', { get: () => rig.camera });
  window.__app = app;

  // first sun application to all subscribers (builders subscribed during build)
  applySun(true);
  lighting.update(performance.now(), true);
  const startView = VIEWS[params.get('view')] ? params.get('view') : 'overview';
  rig.flyTo(startView, { instant: true });
  post.setCamera(rig.camera);
  ui.setLoading(94, `Step ${BUILDERS.length + 1} of ${BUILDERS.length + 1} · Compiling shaders & lighting the scene…`);
  await nextFrame();
  mark('compile');
  // Compile in the background where the driver supports it (KHR_parallel_shader_compile).
  // The scene is drawn into the post chain's linear HDR target (no tone mapping, linear output),
  // so compile with that target bound — otherwise every program is built for the wrong variant
  // and compiled a second time on the first frame (≈ 8 s on ANGLE/D3D11).
  try {
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(post.composer.readBuffer);
    let p;
    try { p = renderer.compileAsync(scene, rig.camera); } finally { renderer.setRenderTarget(prevRT); }
    await p;
  } catch (e) { /* first frame compiles whatever is left */ }
  mark('compiled');

  // ------------------------------------------------------------ main loop
  // Render on demand: a frame is drawn only while something changes (camera, sun, UI, panel) and,
  // briefly after interaction, at a reduced rate for registered ambient animations. When the scene is left alone the GPU goes idle. ?idle=0 renders
  // continuously. On a software renderer / very slow device ("idleMode") time steps are coarser.
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsN = 0, lastStats = 0, fps = 0, elapsed = 0, lastRender = 0, lastDeclutter = 0;
  let lastInput = performance.now(), prevTickRendered = false, pointerDown = false, lastZoom = 1;
  const lastCamPos = new THREE.Vector3(), lastCamQuat = new THREE.Quaternion(), DEG = Math.PI / 180;
  renderer.domElement.addEventListener('pointerdown', () => { pointerDown = true; });
  for (const ev of ['pointerup', 'pointercancel', 'blur']) addEventListener(ev, () => { pointerDown = false; });
  const continuous = params.get('idle') === '0';
  const AMBIENT_FPS = 24, AMBIENT_MS = 12000;
  const slowSamples = [], motionSamples = [], ambientSamples = [];
  idleMode = params.get('idle') === '1' || (!continuous && renderer.getContext && /SwiftShader|llvmpipe|Software/i.test(rendererName(renderer)));
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input', 'change', 'click', 'touchmove']) {
    addEventListener(ev, () => { lastInput = performance.now(); demandRender(ev === 'pointermove' ? 400 : 1500); }, { passive: true, capture: true });
  }
  addEventListener('resize', () => demandRender(1500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastInput = performance.now(); demandRender(1500); } });
  demandRender(3000);
  const elevationBackdrop = createElevationBackdrop(renderer, scene, lighting);
  const loop = () => {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
    const now = performance.now();
    // panel offset easing
    let busy = false;
    if (Math.abs(offsetTarget - offsetCur) > 0.5 || Math.abs(offsetYTarget - offsetYCur) > 0.5) {
      const kk = Math.min(1, Math.max(dt, idleMode ? 1 : 0) * 9);
      offsetCur += (offsetTarget - offsetCur) * kk; offsetYCur += (offsetYTarget - offsetYCur) * kk;
      if (Math.abs(offsetTarget - offsetCur) < 0.5) offsetCur = offsetTarget;
      if (Math.abs(offsetYTarget - offsetYCur) < 0.5) offsetYCur = offsetYTarget;
      rig.setSize(innerWidth, innerHeight, offsetCur, offsetYCur);
      busy = true;
    }
    if (playing) {
      T.min += speed * dt;
      if (T.min > TIME_MAX) T.min = TIME_MIN;
      applySun();
      busy = true;
    }
    const camBusy = rig.update(idleMode && rig.anim ? Math.max(dt, Math.min(rawDt, 0.4)) : dt);
    if (post.camera !== rig.camera) post.setCamera(rig.camera);
    // haze is distance-based: off in orthographic views (the camera stands far away)
    if (scene.fog) scene.fog.density = rig.mode === 'ortho' ? 0 : lighting.fogDensity;
    const elevation = rig.mode === 'ortho' && rig.currentView?.startsWith('elev') && !rig.anim;
    if (elevation) elevationBackdrop.update(rig, ctx.sunState.date.getTime(), quality);
    else elevationBackdrop.clear();
    const street = rig.mode === 'persp' && rig.camera.position.y < 6;
    if (street !== document.body.classList.contains('street')) document.body.classList.toggle('street', street);
    lighting.envInterval = playing ? 1000 : 250;
    if (lighting.update(now)) busy = true;
    updateHover(now);
    updateMeasureGhost(now);
    // adaptive resolution (not on software renderers: they render on demand at full size).
    // "Moving" = the image shifts by more than ~0.6 px per tick (the long damping tail counts as still).
    const cam = rig.camera;
    const dist = Math.max(1, cam.position.distanceTo(rig.controls.target));
    const camMotion = Math.max(cam.position.distanceTo(lastCamPos) / dist, 2 * Math.acos(Math.min(1, Math.abs(cam.quaternion.dot(lastCamQuat)))));
    lastCamPos.copy(cam.position); lastCamQuat.copy(cam.quaternion);
    const pxPerRad = innerHeight / ((cam.isPerspectiveCamera ? cam.fov : 45) * DEG);
    const zooming = cam.isOrthographicCamera && cam.zoom !== lastZoom; lastZoom = cam.zoom;
    const moving = !idleMode && !continuous && (pointerDown || playing || zooming || (camBusy && camMotion * pxPerRad > 0.6));
    setResScale(moving ? motionScale : 1);
    const active = busy || camBusy || playing || now < renderUntil;
    if (lastWasAmbient) { // rAF interval right after an ambient frame ≈ its GPU cost
      lastWasAmbient = false; ambientSamples.push(rawDt);
      if (ambientSamples.length >= 9) { ambientSlow = [...ambientSamples].sort((a, b) => a - b)[4] > 1 / 30; ambientSamples.length = 0; }
    }
    const ambient = !idleMode && !active && !ambientSlow && motionScale > 0.95 && animated.length > 0
      && now - lastInput < AMBIENT_MS && now - lastRender >= 1000 / AMBIENT_FPS - 4;
    const due = continuous || active || ambient || now - lastRender > (idleMode ? 6000 : 3000);
    if (!due) { prevTickRendered = false; return; }
    lastWasAmbient = ambient;
    compass.update(rig.heading());
    scaleBar.update(rig.metresPerPixel(), rig.mode === 'ortho' && ui.layerState('compass'));
    labelRenderer.render(scene, rig.camera);
    if (labels.declutter && now - lastDeclutter > 250) { lastDeclutter = now; try { labels.declutter(); } catch (e) { reportOnce('labels.declutter', e); } }
    // animation time = real time since the previous rendered frame (frames are skipped when idle)
    const adt = Math.min(lastRender ? (now - lastRender) / 1000 : dt, idleMode ? 1 : 0.1);
    elapsed += adt;
    for (const fn of animated) { try { fn(adt, elapsed); } catch (e) { reportOnce('animated', e); } }
    const t0 = performance.now();
    post.render(adt);
    lastFrameMs = performance.now() - t0;
    lastRender = now;
    frameCount++;
    if (frameCount <= 3) mark('frame' + frameCount);
    if (prevTickRendered) { fpsAcc += rawDt; fpsN++; }
    // auto-detect a very slow device → idle mode
    if (!idleMode && frameCount > 3 && !continuous) {
      slowSamples.push(rawDt); if (slowSamples.length > 6) slowSamples.shift();
      if (slowSamples.length === 6 && slowSamples.every((v) => v > 0.6)) { idleMode = true; console.log('[app] slow renderer → idle rendering'); }
    }
    // learn the motion resolution from the frame rate while moving: aim for ≥ 40 fps
    if (moving && prevTickRendered && frameCount > 10) {
      motionSamples.push(rawDt);
      if (motionSamples.length >= 24) {
        const med = [...motionSamples].sort((a, b) => a - b)[12]; motionSamples.length = 0;
        const lo = minMotionScale();
        if (med > 1 / 40 && motionScale > lo + 0.01) motionScale = Math.max(lo, motionScale * (med > 1 / 25 ? 0.75 : 0.88));
        else if (med < 1 / 54 && motionScale < 1) motionScale = Math.min(1, motionScale / 0.9);
        else if (med > 1 / 28 && autoQ && quality === 'high') {
          // still sluggish at the lowest motion resolution → automatically picked High steps down once
          setQuality('medium', false);
          console.log(`[app] ${(1 / med).toFixed(0)} fps while moving → quality medium`);
          ui.toast('Switched to Medium quality for smoother movement (Tools → Quality to change).', 'info', 5000);
        }
      }
    }
    prevTickRendered = true;
    if (now - lastStats > 1000) {
      fps = fpsN / Math.max(1e-3, fpsAcc); fpsAcc = 0; fpsN = 0; lastStats = now;
      const info = renderer.info;
      ui.setStats(`${fps.toFixed(fps < 10 ? 1 : 0)} fps · ${lastFrameMs.toFixed(0)} ms CPU · quality ${quality}${idleMode ? ' · idle rendering' : ''}
${post.stats.calls} draw calls (incl. shadow pass)
${(post.stats.triangles / 1e6).toFixed(2)} M triangles / frame
${info.memory.geometries} geometries · ${info.memory.textures} textures
${occluders.length} occluders · ${animated.length} animated`);
    }
    if (frameCount === 3) {
      ui.setLoading(100, 'Ready');
      ui.hideLoader();
      window.__ready = true; mark('ready');
      console.log('[app] ready', app.stats());
    }
  };
  renderer.setAnimationLoop(loop);
  // pause/resume the render loop (handy for headless capture of a finished frame)
  app.freeze = (on = true) => { renderer.setAnimationLoop(on ? null : loop); if (!on) demandRender(1500); return !!on; };
}

// ---------------------------------------------------------------- helpers
function demandRender(ms = 1000) { renderUntil = Math.max(renderUntil, performance.now() + ms); }
function rendererName(renderer) {
  try {
    const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch (e) { return ''; }
}
const _reported = new Set();
function reportOnce(tag, e) {
  if (_reported.has(tag)) return; _reported.add(tag);
  console.warn(`[app] ${tag}:`, e);
  window.__errors.push(`${tag}: ${e && (e.stack || e)}`);
}
function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
function mark(name) { try { performance.mark(name); } catch (e) { /* ignore */ } }

function initialTime() {
  const t = params.get('t');
  const m = t && /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{2}))?/.exec(t);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], min: m[4] !== undefined ? +m[4] * 60 + +m[5] : 600 };
  const p = localParts(new Date(), SITE.utcOffsetHours);
  return { y: p.year, m: 2, d: 15, min: 600 };
}

/** Simple ground used only when the environment module is missing. */
function makeFallbackGround() {
  const g = new THREE.Group(); g.name = 'fallback-ground';
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#8f7f62'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 110 + Math.random() * 60;
    x.fillStyle = `rgba(${v + 20},${v + 5},${v - 25},0.25)`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(160, 160);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(SITE.center.x, -0.02, -SITE.center.y); ground.receiveShadow = true;
  g.add(ground);
  const shape = new THREE.Shape(site.COMPOUND.polygon.map(([px, py]) => new THREE.Vector2(px, py)));
  const yard = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xb0aca2, roughness: 0.95 }));
  yard.rotation.x = -Math.PI / 2; yard.position.y = 0.0; yard.receiveShadow = true;
  g.add(yard);
  return g;
}
