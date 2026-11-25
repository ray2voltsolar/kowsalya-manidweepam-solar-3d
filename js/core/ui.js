// ============================================================================
//  UI: panel tabs (summary, sun & shade, views, layers, tools), view bar,
//  loader, toasts, tooltip, info card, legends. Pure DOM, no framework.
// ============================================================================
import { formatIN, MONTHS, fmtMinutes, escapeHtml } from './format.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ICON = {
  play: '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5.5v13M16 5.5v13" stroke-width="3"/></svg>',
  camera: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 8h3l2-2.5h6L17 8h3v11H4V8Z"/><circle cx="12" cy="13.2" r="3.6"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" class="ic"><path d="m3.5 16.5 13-13 4 4-13 13-4-4Z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/></svg>',
  full: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  reset: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
  cube: '<svg viewBox="0 0 24 24" class="ic"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
  plan: '<svg viewBox="0 0 24 24" class="ic"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 11h9V4M13 15h7"/></svg>',
  roof: '<svg viewBox="0 0 24 24" class="ic"><path d="m3 12 9-7 9 7"/><path d="M6 10v9h12v-9"/></svg>',
  person: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="5.5" r="2.4"/><path d="M9 21v-6l-1.5-.5V10a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v4.5L15 15v6"/></svg>',
  drone: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="2.2"/><path d="M12 3.5a8.5 8.5 0 1 1-8.1 5.9"/><path d="m3.2 6.2.7 3.2 3.1-.9"/></svg>',
  photo: '<svg viewBox="0 0 24 24" class="ic"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m3.5 16 5-5 4 4 2.5-2.5 5.5 5"/><circle cx="16" cy="9.5" r="1.4"/></svg>',
  close: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  modules: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 18 7 6h10l3 12H4Z"/><path d="M10 6l-1 12M14 6l1 12M5.5 12h13"/></svg>',
  palette: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.3-1.6-1.3-2.8 0-1 .8-1.6 1.8-1.6h2.2a4 4 0 0 0 4-4c0-3.9-3.8-6.9-8.5-6.9Z"/><circle cx="7.6" cy="11" r="1.1"/><circle cx="10.5" cy="7.4" r="1.1"/><circle cx="15" cy="7.6" r="1.1"/></svg>',
  tag: '<svg viewBox="0 0 24 24" class="ic"><path d="M3.5 12.5V4h8.5l8.5 8.5-8 8-9-8Z"/><circle cx="8" cy="8.5" r="1.4"/></svg>',
  globe: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5Z"/></svg>',
  tree: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 21v-6"/><path d="M12 3c3.5 0 6 2.6 6 5.8 0 3.4-2.8 6.2-6 6.2s-6-2.8-6-6.2C6 5.6 8.5 3 12 3Z"/></svg>',
  car: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 16v-3.5L6 8h12l2 4.5V16H4Z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/></svg>',
  sunpath: '<svg viewBox="0 0 24 24" class="ic"><path d="M3 19c2-8 5.5-12 9-12s7 4 9 12"/><circle cx="12" cy="7" r="2.2"/><path d="M2.5 19h19"/></svg>',
  shadow: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 15V6h7v9"/><path d="M6 15h7l7 4H10L6 15Z" fill="currentColor" opacity=".35"/></svg>',
  compass: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.6 4-4 1.6 1.6-4 4-1.6Z"/></svg>',
};

export function createUI({ site, summary, views, handlers }) {
  const H = handlers;
  const ui = {};
  const P = site.PROJECT;

  // ---------------- Header
  $('#brCustomer').textContent = P.customer;
  $('#brLocation').textContent = `Prepared by ${P.preparedBy}`;
  $('#brLocation').title = P.address;
  $('#brSystem').textContent = P.systemLabel;
  $('#siteAddress').textContent = P.address;
  $('.ld-title').textContent = P.customer;
  $('.ld-sub').textContent = P.systemLabel;
  $('.ld-by b').textContent = P.preparedBy;
  document.title = `${P.customer} · ${P.systemLabel}`;
  const syncHeaderHeight = () => document.body.style.setProperty('--card-top',
    document.body.classList.contains('brand-collapsed') ? '72px' : `${$('#brand').getBoundingClientRect().bottom + 10}px`);
  syncHeaderHeight();
  new ResizeObserver(syncHeaderHeight).observe($('#brand'));

  // ---------------- Loader
  ui.setLoading = (pct, text) => {
    $('#ldFill').style.width = `${Math.max(3, Math.min(100, pct))}%`;
    if (text) $('#ldStep').textContent = text;
  };
  ui.hideLoader = () => { $('#loader').classList.add('done'); };

  // ---------------- Toasts
  ui.toast = (msg, type = 'info', ms = 4200) => {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
  };

  // ---------------- Tabs / panel
  const panel = $('#panel');
  const isPhone = () => matchMedia('(max-width: 760px)').matches;
  function setTab(name) {
    $$('.tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
    ui.activeTab = name;
    $('#panelBody').scrollTop = 0;
  }
  function setCollapsed(c) {
    panel.classList.toggle('collapsed', c);
    document.body.classList.toggle('panel-collapsed', c);
    H.onPanelChange && H.onPanelChange();
  }
  ui.setCollapsed = setCollapsed;
  ui.isCollapsed = () => panel.classList.contains('collapsed');
  $$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    if (isPhone()) {
      if (ui.activeTab === b.dataset.tab && !ui.isCollapsed()) { setCollapsed(true); return; }
      if (ui.isCollapsed()) setCollapsed(false);
    }
    setTab(b.dataset.tab);
  }));
  ui.activeTab = 'summary';
  // The title card and the bottom controls can each be put away; the choice is remembered on this device.
  const pref = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  function setBrandCollapsed(c, persist = true) {
    document.body.classList.toggle('brand-collapsed', c);
    $('#brand').inert = c;
    if (persist) pref.set('r2v.card', c ? 'hidden' : 'shown');
    syncHeaderHeight();
  }
  function setBottomHidden(h, persist = true) {
    document.body.classList.toggle('bottom-hidden', h);
    $('#viewbar').inert = h;
    panel.inert = h && isPhone();
    if (persist) pref.set('r2v.bottom', h ? 'hidden' : 'shown');
    H.onPanelChange && H.onPanelChange();
  }
  ui.setBrandCollapsed = setBrandCollapsed;
  ui.setBottomHidden = setBottomHidden;
  ui.isBottomHidden = () => document.body.classList.contains('bottom-hidden');
  $('#brandCollapse').addEventListener('click', () => setBrandCollapsed(true));
  $('#brandOpen').addEventListener('click', () => setBrandCollapsed(false));
  $('#bottomOpen').addEventListener('click', () => setBottomHidden(false));
  // phones start with the title card put away so the model has the screen
  { const saved = pref.get('r2v.card'); setBrandCollapsed(saved ? saved === 'hidden' : isPhone(), false); }
  if (pref.get('r2v.bottom') === 'hidden') setBottomHidden(true, false);
  // desktop: the chevron slides the side panel away to the right; phone: it puts the whole bottom sheet away
  $('#panelCollapse').addEventListener('click', () => (isPhone() ? setBottomHidden(true) : setCollapsed(true)));
  $('#panelOpen').addEventListener('click', () => setCollapsed(false));
  $('#sheetGrip').addEventListener('click', () => setCollapsed(!ui.isCollapsed()));
  ui.togglePanel = () => setCollapsed(!ui.isCollapsed());
  ui.setTab = setTab;
  // Panel offset for the 3D view (desktop: shift the scene centre left of the panel)
  ui.panelOffsetPx = () => {
    if (isPhone() || ui.isCollapsed()) return 0;
    const r = panel.getBoundingClientRect();
    if (!r.width || document.body.classList.contains('clean')) return 0;
    return Math.max(0, innerWidth - r.left);
  };
  // Phone: the bottom sheet (+ the view bar above it) hides the lower part of the 3D view → the
  // camera recentres the model in the visible area above it (computed from the CSS, not the
  // animating rect, so it is correct immediately after a toggle).
  ui.panelOffsetY = () => {
    if (!isPhone() || document.body.classList.contains('clean') || document.body.classList.contains('bottom-hidden')) return 0;
    const sheet = ui.isCollapsed() ? 64 : 0.56 * innerHeight;
    const vb = $('#viewbar'); const vbh = vb ? (vb.getBoundingClientRect().height || 44) : 44;
    return Math.max(0, Math.min(innerHeight * 0.7, sheet + vbh + 12));
  };
  // phones (portrait sheet) and short landscape screens (phone rotated, ≤ 500 px high) start with the panel collapsed
  if (isPhone() || matchMedia('(max-height: 500px) and (orientation: landscape)').matches) setCollapsed(true);
  // keep pointer/wheel events inside the panel from reaching the canvas
  for (const el of [panel, $('#viewbar'), $('#brand'), $('#infocard'), $('#legendFloat')]) {
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  // ---------------- SUMMARY
  {
    const s = summary;
    const allowance = s.shadingInsideSystemLoss;
    const shadeNote = Number.isFinite(s.shadingLossPct)
      ? ` · near-shading loss ${s.shadingLossPct.toFixed(2)} %${allowance ? ` (included in ${s.systemLossPct}% system loss)` : ''}` : '';
    const {geometry} = site.LAYOUT;
    const rows = Object.entries(s.perBlock).map(([id, block]) => `
      <tr class="clickable" data-roof="${id}"><td><button class="table-link" data-view="block${id}">${escapeHtml(site.BLOCKS[id].name)}</button></td>
      <td class="num">${block.modules}</td><td class="num">${block.kwp.toFixed(2)}</td></tr>`).join('');
    const capacity = site.CAPACITY_STUDY.map(v => {
      const url = new URL(location.href);
      url.searchParams.set('module', v.module); url.searchParams.set('mount', v.mounting);
      const active = site.VARIANT.m === v.module && site.VARIANT.t === v.mounting;
      return `<tr class="${active ? 'selected-variant' : ''}"><td><a href="${escapeHtml(url.search)}" ${active ? 'aria-current="true"' : ''}>${v.wp} W · ${v.mounting}</a></td><td class="num">${v.goodPractice.modules}</td><td class="num">${v.goodPractice.kwp.toFixed(1)}</td><td class="num">${v.meetsTarget ? 'Yes' : 'No'}</td></tr>`;
    }).join('');
    $('#paneSummary').innerHTML = `
      <div class="hero">
        <div class="kpi primary"><div class="k">Proposed DC capacity</div><div class="v">${s.kwp.toFixed(2)}<small>kWp</small></div><div class="k">${s.modules} modules × ${site.MODULE.wp} Wp</div></div>
        <div class="kpi energy-kpi"><div class="k">Year-1 generation</div><div class="v">${formatIN(Math.round(s.annualKwh))}<small>kWh</small></div><div class="k">${(s.annualKwh / 100000).toFixed(2)} lakh units · after ${s.firstYearDegradationPct} % first-year degradation</div>
        <div class="energy-source">PVGIS 5.3 · ${s.systemLossPct} % total system loss, near shading included · ${formatIN(Math.round(s.annualBeforeDegradationKwh))} kWh before degradation</div></div>
        <div class="kpi"><div class="v">${formatIN(Math.round(s.specificYield))}</div><div class="k">Specific yield · kWh/kWp</div></div>
        <div class="kpi"><div class="v">${formatIN(s.co2TonnesPerYear, 1)}<small>t/yr</small></div><div class="k">CO₂ avoided</div></div>
      </div>
      <h2 class="sec">Capacity by block</h2>
      <table class="tbl" id="roofTable"><thead><tr><th>Wing</th><th class="num">Modules</th><th class="num">kWp</th></tr></thead><tbody>${rows}</tbody></table>
      <h2 class="sec">Monthly generation</h2>
      <div class="chart" id="monthlyChart"></div>
      <p class="note">kWh · ${escapeHtml(site.PVGIS.S.database)} · ${escapeHtml(site.PVGIS.S.years)}</p>
      <h2 class="sec">Plant design</h2>
      <div class="design-presets"><b>${escapeHtml(site.MODULE.label)}</b><span>${escapeHtml(site.MOUNTING.label)}</span></div>
      <dl class="design-data">
        <dt>Tilt / azimuth</dt><dd>${s.tiltDeg}° / ${s.azimuthDeg}° south</dd>
        <dt>Row pitch · 1P / 2P</dt><dd>${geometry.pitch1.toFixed(2)} / ${geometry.pitch2.toFixed(2)} m</dd>
        <dt>Inverters</dt><dd>${s.inverters} × ${site.INVERTERS[0].kw} kW</dd>
        <dt>Strings / DC-to-AC ratio</dt><dd>${s.strings} / ${s.dcAcRatio.toFixed(2)}</dd>
      </dl>
      <h2 class="sec">How much fits</h2>
      <p class="note cap-note">Maximum capacity with ${escapeHtml(site.CAPACITY_STUDY[0].goodPractice.rule)}.</p>
      <table class="tbl capacity"><thead><tr><th>Variant</th><th class="num">Modules</th><th class="num">kWp</th><th class="num">≥ ${site.CONFIG.targetKwp}?</th></tr></thead><tbody>${capacity}</tbody></table>
      <h2 class="sec">Site assumptions</h2>
      <p class="note">The ${site.BUILDING.roofZ.toFixed(1)} m terrace height assumes ${site.BUILDING.floors} storeys at ${site.BUILDING.floorHeight.toFixed(1)} m each. The roof outline was traced from satellite imagery (±${site.BUILD_INFO.roofTrace.precisionM} m). Verify dimensions and clearances on site.</p>`;
    $$('#roofTable tr[data-roof]').forEach(tr => tr.addEventListener('click', () => H.onView('block' + tr.dataset.roof)));
    renderMonthlyChart($('#monthlyChart'), s.monthlyKwh);
  }

  // ---------------- SUN & SHADE
  {
    $('#paneSun').innerHTML = `
      <h2 class="sec">Date &amp; time (IST)</h2>
      <div class="row"><div class="time-big grow" id="timeBig">10:00<small>IST</small></div>
        <input type="date" id="dateIn" aria-label="Date"></div>
      <input type="range" id="timeIn" min="330" max="1140" step="5" value="600" aria-label="Time of day">
      <div class="ticks"><span>05:30</span><span>09:00</span><span>12:30</span><span>16:00</span><span>19:00</span></div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="playBtn" title="Play / pause the day (Space)">${ICON.play}<span>Play day</span></button>
        <select id="speedIn" title="Animation speed" aria-label="Animation speed">
          <option value="15">15 min/s</option><option value="30" selected>30 min/s</option><option value="60">1 h/s</option><option value="120">2 h/s</option>
        </select>
        <button class="btn sm" id="nowBtn" title="Current date & time">Now</button>
      </div>
      <div class="chips" style="margin-top:10px" id="quickDates">
        ${[[12,9],[12,12],[12,15],[3,12],[6,12]].map(([month,hour]) => `<button class="chip-btn" data-md="${month}-21-${hour}">21 ${MONTHS[month-1].slice(0,3)} <small>${String(hour).padStart(2,'0')}:00</small></button>`).join('')}
      </div>
      <div class="readout">
        <div><span>Azimuth</span><b id="roAz">–</b></div>
        <div><span>Elevation</span><b id="roEl">–</b></div>
        <div><span>Day length</span><b id="roLen">–</b></div>
        <div><span>Sunrise</span><b id="roRise">–</b></div>
        <div><span>Solar noon</span><b id="roNoon">–</b></div>
        <div><span>Sunset</span><b id="roSet">–</b></div>
      </div>

      <h2 class="sec">In-browser shade analysis</h2>
      <p class="note" style="margin:0 0 9px">Estimates how much direct sunlight each module loses to nearby obstructions and adjacent rows.</p>
      <div class="btn-grid">
        <button class="btn" id="shadeDay">Analyse this day</button>
        <button class="btn" id="shadeYear">Analyse full year</button>
      </div>
      <div id="shadeRun" hidden style="margin-top:10px">
        <div class="shade-status"><span id="shadeLbl">Analysing…</span><span id="shadePct">0%</span></div>
        <div class="progress"><i id="shadeBar"></i></div>
        <div class="row" style="margin-top:8px;justify-content:flex-end"><button class="btn sm" id="shadeCancel">Cancel</button></div>
      </div>
      <div id="shadeRes" hidden></div>
    `;
    const dateIn = $('#dateIn'), timeIn = $('#timeIn');
    dateIn.addEventListener('change', () => {
      const [y, m, d] = dateIn.value.split('-').map(Number);
      if (y && m && d) H.onDate(y, m, d);
    });
    timeIn.addEventListener('input', () => H.onTime(+timeIn.value));
    $('#playBtn').addEventListener('click', () => H.onPlay());
    $('#speedIn').addEventListener('change', () => H.onSpeed(+$('#speedIn').value));
    $('#nowBtn').addEventListener('click', () => H.onNow());
    $$('#quickDates [data-md]').forEach((b) => b.addEventListener('click', () => {
      const [m, d, hour] = b.dataset.md.split('-').map(Number); H.onQuickDate(m, d, hour);
    }));
    $('#shadeDay').addEventListener('click', () => H.onShade('day'));
    $('#shadeYear').addEventListener('click', () => H.onShade('year'));
    $('#shadeCancel').addEventListener('click', () => H.onShadeCancel());
  }
  ui.setDate = (y, m, d) => {
    $('#dateIn').value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  };
  ui.setTime = (min) => {
    const [,month,day] = $('#dateIn').value.split('-').map(Number);
    $$('#quickDates [data-md]').forEach(b => b.classList.toggle('on', b.dataset.md === `${month}-${day}-${min/60}`));
    const ti = $('#timeIn');
    if (+ti.value !== min) ti.value = min;
    $('#timeBig').innerHTML = `${fmtMinutes(min)}<small>IST</small>`;
    const pct = ((min - 330) / (1140 - 330)) * 100;
    ti.style.setProperty('--track', `linear-gradient(90deg, var(--accent) ${pct}%, rgba(255,255,255,.14) ${pct}%)`);
  };
  ui.setSunReadout = (r) => {
    $('#roAz').textContent = `${r.azimuth.toFixed(1)}°`;
    $('#roEl').textContent = `${r.elevation.toFixed(1)}°`;
    $('#roRise').textContent = r.sunrise; $('#roSet').textContent = r.sunset; $('#roNoon').textContent = r.noon;
    $('#roLen').textContent = r.dayLength;
    const chip = $('#sunChip');
    chip.classList.toggle('night', r.elevation < 0);
    $('#sunChipText').textContent = `${r.dateLabel} · ${r.timeLabel} IST · ` +
      (r.elevation < -0.8 ? 'Sun below horizon' : `Sun ${r.azimuth.toFixed(0)}° az, ${r.elevation.toFixed(0)}° el`);
  };
  ui.setPlaying = (p) => {
    const b = $('#playBtn');
    b.innerHTML = p ? `${ICON.pause}<span>Pause</span>` : `${ICON.play}<span>Play day</span>`;
    b.classList.toggle('primary', !p); b.classList.toggle('on', p);
  };

  // shade analysis UI
  ui.shade = {
    setAvailable(ok) {
      ui.shade.available = ok;
      for (const id of ['#shadeDay', '#shadeYear']) $(id).classList.toggle('unavail', !ok);
    },
    start(kind, dateLabel) {
      $('#shadeRun').hidden = false;
      $('#shadeLbl').textContent = kind === 'year' ? 'Analysing full year (21st of each month)…' : `Analysing ${dateLabel}…`;
      $('#shadeDay').disabled = true; $('#shadeYear').disabled = true;
      ui.shade.progress(0);
    },
    progress(p) {
      const pct = Math.round(p * 100);
      $('#shadeBar').style.width = `${pct}%`; $('#shadePct').textContent = `${pct}%`;
    },
    end() {
      $('#shadeRun').hidden = true;
      $('#shadeDay').disabled = false; $('#shadeYear').disabled = false;
    },
    showResult(html) {
      const el = $('#shadeRes'); el.hidden = false; el.innerHTML = html;
      $$('[data-mod]', el).forEach((li) => li.addEventListener('click', () => H.onModuleFocus(+li.dataset.mod)));
      const clr = $('#shadeClear', el); if (clr) clr.addEventListener('click', () => H.onShadeClear());
    },
    clear() { const el = $('#shadeRes'); el.hidden = true; el.innerHTML = ''; },
  };

  // ---------------- VIEWS (pane + bar)
  {
    const groups = [
      ['main', 'Site'], ['roof', 'Roof close-ups'], ['street', 'Street level'], ['detail', 'Terrace level'], ['elev', 'Elevations (orthographic)'],
    ];
    let html = `<h2 class="sec">Projection</h2>
      <div class="seg full" id="modeSeg"><button data-mode="persp" class="on">Perspective</button><button data-mode="ortho">Orthographic</button></div>
      <p class="note">Press <span class="kbd">O</span> to toggle. The framing is kept when switching.</p>`;
    for (const [g, title] of groups) {
      html += `<h2 class="sec">${title}</h2><div class="view-list">`;
      for (const [k, v] of Object.entries(views)) {
        if (v.group !== g) continue;
        html += `<button class="view-btn" data-view="${k}" title="${escapeHtml(v.note || v.title || v.label)}"><span>${escapeHtml(v.title || v.label)}</span>${v.key ? `<kbd>${v.key}</kbd>` : ''}</button>`;
      }
      html += '</div>';
    }
    $('#paneViews').innerHTML = html;
    $$('#paneViews [data-view]').forEach((b) => b.addEventListener('click', () => H.onView(b.dataset.view)));
    $$('#modeSeg [data-mode]').forEach((b) => b.addEventListener('click', () => H.onMode(b.dataset.mode)));

    const vb = $('#viewbar');
    const ic = { overview: ICON.cube, plan: ICON.plan, road: ICON.person, drone: ICON.drone };
    const short = { road: 'Road', gate: 'Gate', inverter: 'Station', drone: 'Drone', blockA: 'A', blockB: 'B', blockC: 'C' };
    const item = (k) => `<button class="vb" data-view="${k}" title="${escapeHtml((views[k].note || views[k].title || views[k].label) + (views[k].key ? ` (${views[k].key})` : ''))}">${ic[k] || ''}<span>${escapeHtml(short[k] || views[k].label)}</span></button>`;
    vb.innerHTML = `
      <button class="vb" id="vbMode" title="Perspective / orthographic (O)">${ICON.cube}<span>3D</span></button>
      <span class="sep"></span>
      ${item('overview')}${item('plan')}
      <span class="elev"><span class="elev-lbl">Elev.</span>${['elevN', 'elevS', 'elevE', 'elevW'].map((k) => `<button class="vb" data-view="${k}" title="${views[k].title}">${views[k].label}</button>`).join('')}</span>
      <span class="sep"></span>
      <span class="elev"><span class="elev-lbl">Roofs</span>${item('blockA')}${item('blockB')}${item('blockC')}</span>
      <span class="sep"></span>
      ${item('road')}${item('gate')}${item('terrace')}${item('inverter')}
      <span class="sep"></span>
      ${item('drone')}
      <button class="vb vb-hide" id="vbHide" title="Hide this bar" aria-label="Hide the view bar"><svg viewBox="0 0 24 24" class="ic"><path d="m6 9 6 6 6-6"/></svg></button>
    `;
    $$('#viewbar [data-view]').forEach((b) => b.addEventListener('click', () => H.onView(b.dataset.view)));
    $('#vbMode').addEventListener('click', () => H.onMode('toggle'));
    $('#vbHide').addEventListener('click', () => setBottomHidden(true));
  }
  ui.setActiveView = (name) => {
    $$('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === (views[name]?.alias || name)));
  };
  ui.setMode = (mode) => {
    $$('#modeSeg [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const m = $('#vbMode');
    m.innerHTML = mode === 'ortho' ? `${ICON.plan}<span>Ortho</span>` : `${ICON.cube}<span>3D</span>`;
    m.title = mode === 'ortho' ? 'Orthographic — click for perspective (O)' : 'Perspective — click for orthographic (O)';
  };
  ui.setDrone = (on) => { $$('[data-view="drone"]').forEach((b) => b.classList.toggle('on', on)); };

  // ---------------- LAYERS
  const LAYERS = [
    ['labels', 'Labels', 'Wings, inverter stations and road', ICON.tag, true],
    ['satellite', 'Satellite imagery', 'Geographic context', ICON.globe, true],
    ['vegetation', 'Vegetation', 'Trees and planted areas', ICON.tree, true],
    ['vehicles', 'Vehicles', 'Road and parking areas', ICON.car, true],
    ['context', 'Context buildings', 'Neighbouring properties', ICON.roof, true],
    ['sunpath', 'Sun path', 'Daily sun arc, hour marks', ICON.sunpath, false],
    ['shadows', 'Shadows', 'Real-time sun shadows', ICON.shadow, true],
    ['compass', 'Compass', 'North arrow & scale bar', ICON.compass, true],
  ];
  {
    $('#paneLayers').innerHTML = `<h2 class="sec">Solar plant</h2><label class="colour-select">Module colour<select id="colorMode"><option value="normal">Natural finish</option><option value="strings">Strings</option><option value="inverters">Inverters</option><option value="heatmap">Shading heat map</option></select></label><div id="groupLegend" hidden></div><h2 class="sec">Show / hide</h2>` + LAYERS.map(([k, t, sub, ic, on]) => `
      <label class="toggle" data-layer="${k}"><span class="t-ic">${ic}</span><span class="t-lbl">${t}<small>${sub}</small></span>
        <input type="checkbox" ${on ? 'checked' : ''}><span class="switch"></span></label>`).join('');
    $$('#paneLayers [data-layer]').forEach((l) => {
      const inp = $('input', l);
      inp.addEventListener('change', () => {
        if (l.classList.contains('disabled')) { inp.checked = !inp.checked; return; }
        H.onLayer(l.dataset.layer, inp.checked);
      });
    });
    $('#colorMode').addEventListener('change', e => H.onColorMode(e.target.value));
    $$('#plantSwitch button').forEach(b => b.addEventListener('click', () => H.onLayer('modules', b.dataset.plant === 'on')));
  }
  ui.layerState = k => {
    if (k === 'modules') return $('#plantSwitch [data-plant="on"]').classList.contains('on');
    if (k === 'strings') return $('#colorMode').value === 'strings';
    return !!$('[data-layer="'+k+'"] input')?.checked;
  };
  ui.setLayer = (k, on) => {
    if (k === 'modules') {
      $$('#plantSwitch button').forEach(b => {
        const selected = (b.dataset.plant === 'on') === on;
        b.classList.toggle('on',selected); b.setAttribute('aria-pressed',String(selected));
      });
    } else if (k === 'strings') $('#colorMode').value = on ? 'strings' : 'normal';
    else { const input = $('[data-layer="'+k+'"] input'); if (input) input.checked = on; }
  };
  ui.setLayerAvailable = (k, ok) => {
    const inputs = k === 'modules' ? $$('#plantSwitch button') : k === 'strings' ? [$('#colorMode')] : $$('[data-layer="'+k+'"] input');
    inputs.forEach(input => input.disabled = !ok);
  };
  ui.setColorMode = (mode, plantVisible) => {
    $('#colorMode').value = mode;
    const box = $('#groupLegend');
    const byString = mode === 'strings';
    const legend = site.INVERTERS.map(inv => {
      const strings = site.STRINGS.filter(s => s.inverter === inv.id);
      const colors = byString ? strings.map(s => site.STRING_COLORS[s.index]) : [site.INVERTER_COLORS[inv.id]];
      return `<div class="legend-row"><b>${inv.id}</b><span>${strings[0].id}–${strings.at(-1).id}</span><i>${colors.map(c => `<i style="background:${c}"></i>`).join('')}</i></div>`;
    }).join('');
    box.innerHTML = legend;
    box.hidden = !plantVisible || (mode !== 'inverters' && !byString);
    if (!box.hidden) {
      $('#legendFloat').innerHTML = `<div class="lf-t">${byString ? 'Electrical strings' : 'Inverter groups'}</div>${legend}`;
      $('#legendFloat').hidden = false;
    } else ui.hideLegend();
  };

  // ---------------- TOOLS
  {
    $('#paneTools').innerHTML = `
      <h2 class="sec">Tools</h2>
      <div class="btn-grid">
        <button class="btn" id="toolShot" title="Download a high-resolution PNG, up to 2× the window, max ≈ 10 MP (P)">${ICON.camera}<span>Screenshot</span></button>
        <button class="btn" id="toolMeasure" title="Measure a distance (M)">${ICON.ruler}<span>Measure</span></button>
        <button class="btn" id="toolFull" title="Fullscreen (F)">${ICON.full}<span>Fullscreen</span></button>
        <button class="btn" id="toolReset" title="Reset view (R)">${ICON.reset}<span>Reset view</span></button>
      </div>
      <div class="row" style="margin-top:8px"><button class="btn sm grow" id="toolMeasureClear">Clear measurements</button></div>
      <h2 class="sec">Render quality</h2>
      <div class="seg full" id="qualSeg"><button data-q="high">High</button><button data-q="medium">Medium</button><button data-q="low">Low</button></div>
      <p class="note" id="qualNote">High: 4K shadows, ambient occlusion, SMAA. Low suits phones & older laptops.</p>
      <h2 class="sec">Keyboard</h2>
      <div class="kbd-list">
        <span class="kbd">0–9</span><span>Camera presets</span><span class="kbd">B</span><span>Proposed / bare roof</span>
        <span class="kbd">O</span><span>Perspective / orthographic</span>
        <span class="kbd">Space</span><span>Play / pause the sun</span>
        <span class="kbd">M</span><span>Measure · <span class="kbd">Esc</span> cancel</span>
        <span class="kbd">L</span><span>Labels on / off</span>
        <span class="kbd">P</span><span>Screenshot</span>
        <span class="kbd">F</span><span>Fullscreen</span>
        <span class="kbd">R</span><span>Reset view</span>
        <span class="kbd">H</span><span>Hide / show panel</span>
      </div>
      <h2 class="sec">Mouse &amp; touch</h2>
      <p class="note" style="margin:0">Left-drag / one finger: orbit · Right-drag / two fingers: pan · Wheel / pinch: zoom to cursor. Hover a module for details, click a building for its info card.</p>
      <h2 class="sec">Scene</h2>
      <div class="stats" id="stats">–</div>
    `;
    $('#toolShot').addEventListener('click', () => H.onScreenshot());
    $('#toolMeasure').addEventListener('click', () => H.onMeasure());
    $('#toolMeasureClear').addEventListener('click', () => H.onMeasureClear());
    $('#toolFull').addEventListener('click', () => H.onFullscreen());
    $('#toolReset').addEventListener('click', () => H.onReset());
    $$('#qualSeg [data-q]').forEach((b) => b.addEventListener('click', () => H.onQuality(b.dataset.q)));
  }
  ui.setQuality = q => {
    $$('#qualSeg [data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === q));
    $('#qualNote').textContent = q === 'ultra' ? 'Ultra print quality · 8K shadows, high-sample ambient occlusion and SMAA.' : 'High uses 4K shadows, ambient occlusion and SMAA. Low suits phones and older laptops.';
  };
  ui.setMeasureActive = (on) => {
    $('#toolMeasure').classList.toggle('on', on);
    const h = $('#measureHint');
    h.hidden = !on;
    if (on) {
      h.innerHTML = `${ICON.ruler}<span>Click two points on any surface · <span class="kbd">Esc</span> to finish</span><button class="btn sm" id="mhDone">Done</button>`;
      $('#mhDone').addEventListener('click', () => H.onMeasure(false));
    }
  };
  ui.setStats = (txt) => { const s = $('#stats'); if (s && ui.activeTab === 'tools' && !ui.isCollapsed()) s.textContent = txt; };

  // ---------------- Tooltip & info card
  const tip = $('#tooltip');
  ui.showTooltip = (x, y, html) => {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let tx = x + 16, ty = y + 16;
    if (tx + r.width > innerWidth - 8) tx = x - r.width - 16;
    if (ty + r.height > innerHeight - 8) ty = y - r.height - 16;
    tip.style.left = `${Math.max(8, tx)}px`; tip.style.top = `${Math.max(8, ty)}px`;
  };
  ui.hideTooltip = () => { tip.hidden = true; };
  const card = $('#infocard');
  ui.showCard = (html) => {
    card.innerHTML = `<button class="close" aria-label="Close" id="cardClose">${ICON.close}</button>${html}`;
    card.hidden = false;
    $('#cardClose').addEventListener('click', () => ui.hideCard());
    $$('[data-view]', card).forEach((b) => b.addEventListener('click', () => H.onView(b.dataset.view)));
  };
  ui.hideCard = () => { card.hidden = true; H.onCardClose && H.onCardClose(); };
  ui.cardOpen = () => !card.hidden;

  // ---------------- Floating legend
  const lf = $('#legendFloat');
  ui.showHeatLegend = (title, sub, opts = {}) => {
    // opts.ticks: fractions shaded at the 5 legend stops (the 3D heat map auto-ranges to the worst module)
    const ticks = Array.isArray(opts.ticks) && opts.ticks.length === 5 ? opts.ticks : [0, 0.25, 0.5, 0.75, 1];
    const pct = (f) => { const v = f * 100; return (v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1)) + '%'; };
    const grad = Array.isArray(opts.colors) && opts.colors.length >= 2 ? ` style="background:linear-gradient(90deg,${opts.colors.join(',')})"` : '';
    lf.innerHTML = `<div class="lf-t">${escapeHtml(title)}<span>${escapeHtml(sub || '')}</span></div><div class="legend-bar"${grad}></div>
      <div class="legend-ticks">${ticks.map((t, i) => `<span>${pct(t)}${i === 4 ? ' shaded' : ''}</span>`).join('')}</div>`;
    lf.hidden = false;
  };
  ui.hideLegend = () => { lf.hidden = true; };

  ui.setAttribution = (txt) => { $('#attrib').textContent = txt; };

  return ui;
}

/** Single-series monthly bar chart (inline SVG) with hover tooltip. */
function renderMonthlyChart(el, monthly) {
  const W = 340, Hh = 150, padL = 30, padR = 4, padT = 16, padB = 18;
  const max = Math.max(...monthly);
  const step = Math.max(5000, Math.ceil(max / 4 / 5000) * 5000);
  const top = Math.ceil(max / step) * step;
  const iw = W - padL - padR, ih = Hh - padT - padB;
  const bw = iw / 12;
  const barW = Math.max(6, bw - 6);
  const y = (v) => padT + ih - (v / top) * ih;
  const maxI = monthly.indexOf(max), minI = monthly.indexOf(Math.min(...monthly));
  let grid = '', axis = '', bars = '';
  for (let v = 0; v <= top; v += step) {
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    axis += `<text x="${padL - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${v / 1000}k</text>`;
  }
  monthly.forEach((v, i) => {
    const x = padL + i * bw + (bw - barW) / 2;
    const yy = y(v), h = padT + ih - yy;
    const r = Math.min(4, barW / 2);
    // rounded top, square baseline
    const d = `M${x},${padT + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${padT + ih} Z`;
    bars += `<g class="bar-g" data-i="${i}"><path class="bar" d="${d}"/><rect class="bar-hit" x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ih + padB}"/>
      <text class="axis-m" x="${x + barW / 2}" y="${Hh - 5}" text-anchor="middle">${MONTHS[i][0]}</text>
      ${i === maxI || i === minI ? `<text class="dl" x="${x + barW / 2}" y="${yy - 4}" text-anchor="middle">${(v / 1000).toFixed(1)}k</text>` : ''}</g>`;
    void h;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Monthly generation, kWh">
    <g class="grid">${grid}</g><g class="axis">${axis}</g><g class="axis">${bars}</g></svg><div class="chart-tip" hidden></div>`;
  const tipEl = el.querySelector('.chart-tip');
  el.querySelectorAll('.bar-g').forEach((g) => {
    g.addEventListener('pointerenter', () => {
      const i = +g.dataset.i;
      g.classList.add('hl');
      const sx = el.clientWidth / W;
      const x = (padL + i * bw + bw / 2) * sx, yy = y(monthly[i]) * sx;
      tipEl.innerHTML = `<b>${MONTHS[i]}</b> · ${formatIN(Math.round(monthly[i]))} kWh <span>(${formatIN(Math.round(monthly[i] / [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]))} kWh/day)</span>`;
      tipEl.style.left = `${x}px`; tipEl.style.top = `${yy - 6}px`; tipEl.hidden = false;
    });
    g.addEventListener('pointerleave', () => { g.classList.remove('hl'); tipEl.hidden = true; });
  });
}
