// ============================================================================
//  DESIGN CONFIG — the open design decisions, one value each.
//  Change a value, then run:   node tools/build-layout.mjs
//  (regenerates webapp/js/layout-data.js, layout.json and the capacity study).
//  The app can also preview any pre-computed variant without a re-run:
//      index.html?module=M700&mount=elevated
// ============================================================================

export const CONFIG = {
  // ---- which presets the main scene shows --------------------------------
  modulePreset: 'M630',        // 'M630' (confirmed by the owner, 25 Nov 2026) | 'M700'
  mountingPreset: 'ballast',   // 'ballast' | 'elevated'
  targetKwp: 450,              // sold capacity; the layout is trimmed to the first module count that reaches it (715 x 630 Wp = 450.45 kWp)

  // ---- building ----------------------------------------------------------
  floors: 6,                   // stilt/ground + 5 upper floors (counted on street-level imagery)
  floorHeight: 3.0,            // m, assumed floor-to-floor
  parapetHeight: 1.0,          // m above terrace finish (assumed, typical 0.9-1.2 m)
  parapetThickness: 0.15,      // m

  // ---- array geometry ----------------------------------------------------
  tiltDeg: 10,
  azimuthDeg: 180,             // 180 = due south
  shadeWindow: { month: 12, day: 21, from: '09:00', to: '15:00' },   // no inter-row / obstacle shading inside this window
  edgeSetback: 0.90,           // m from the slab edge to the nearest module (0.15 m parapet + 0.75 m access)
  obstacleClearance: 0.60,     // m service clearance around head-rooms, tanks, vent boxes
  arrayAisle: 0.60,            // m minimum walkway between neighbouring arrays
  maxTableCols: 12,            // modules per structural table along the row before a 0.6 m break

  // ---- electrical --------------------------------------------------------
  inverterKw: 100,             // three-phase 415 V string inverter rating (kW AC) — confirmed by the owner
  inverterCount: 4,            // 4 x 100 kW = 400 kW AC
  stringLen: { min: 18, max: 21, prefer: 20 },   // 21 x Voc at 10 degC stays under the 1100 V DC limit of this inverter class

  // ---- energy ------------------------------------------------------------
  pvgisLossPct: 16,            // total system loss used for the HEADLINE, as in the proposal: PVGIS default 14 % + 2 % for soiling and the
                               // multi-terrace layout (the 0.6 % near-shading loss from the study sits inside this allowance)
  firstYearDegradationPct: 1,  // year-1 figure = annual x (1 - this)
  // Headline generation exactly as printed in the proposal, so the customer never sees two numbers. Applied only when the layout
  // is the offered 450.45 kWp; tools/build-layout.mjs recomputes the same thing from PVGIS and reports the difference (0.01 %).
  proposalEnergy: { kwp: 450.45, annualBeforeDegradationKwh: 651850, year1Kwh: 645331,
    monthlyYear1Kwh: [60080, 58636, 65571, 61573, 62304, 47933, 39607, 43242, 44528, 53474, 52470, 55913] },
  gridEmissionFactor: 0.71,    // kg CO2 per kWh (CEA grid average, approx.)
};

export const MODULE_PRESETS = {
  M630: {
    key: 'M630', label: '630 Wp N-type TOPCon bifacial (G12R, glass-glass)',
    wp: 630, length: 2.382, width: 1.134, thickness: 0.030, weightKg: 32.5,
    cells: 132, cellCols: 6, cellRows: 22, frameWidth: 0.035,
    efficiencyPct: 23.3, voc: 48.9, vmp: 40.9, isc: 16.32, imp: 15.41, tempCoeffVocPctPerK: -0.25,
    makes: 'RenewSys / Waaree / Adani',
    note: 'Owner-confirmed class. Size 2382 x 1134 x 30 mm is the standard G12R 132-half-cell format; electrical values are typical for the class, not from a specific datasheet - confirm against the datasheet of the make finally supplied.',
  },
  M700: {
    key: 'M700', label: '700 Wp N-type TOPCon bifacial (G12, glass-glass)',
    wp: 700, length: 2.384, width: 1.303, thickness: 0.033, weightKg: 38.3,
    cells: 132, cellCols: 6, cellRows: 22, frameWidth: 0.035,
    efficiencyPct: 22.5, voc: 48.6, vmp: 40.9, isc: 18.32, imp: 17.12, tempCoeffVocPctPerK: -0.25,
    note: 'Alternative kept for comparison. Typical 700 Wp G12 class values.',
  },
};

export const MOUNTING_PRESETS = {
  ballast: {
    key: 'ballast', label: 'Low-ballast fixed tilt on RCC (pedestal blocks, no roof penetration)',
    lowerEdge: 0.50,           // m, module lower edge above terrace finish
    rowsPerTable: [2, 1],      // allowed portrait rows per table, preferred first
    spansSlots: false,         // cannot bridge the open ducts between flats
    clearsLowObstacles: false,
    edgeSetback: null,         // null = CONFIG.edgeSetback
  },
  elevated: {
    key: 'elevated', label: 'Elevated structure (2.4 m clear) - terrace stays usable underneath',
    lowerEdge: 2.40,
    rowsPerTable: [2, 1],
    spansSlots: true,          // portal frames bridge ducts up to maxSlotSpan wide
    maxSlotSpan: 2.8,
    clearsLowObstacles: true,  // passes over parapets, vent boxes and anything under 2.2 m
    edgeSetback: 0.50,
  },
};
