// Reference data shared by server, AI tools and (via /api/meta) the UI.

export const SKILLS: Record<string, string> = {
  ac: 'Air conditioning (split/multi-split)',
  vrf: 'VRF / VRV systems',
  refrigeration: 'Commercial refrigeration',
  heat_pumps: 'Heat pumps',
  chillers: 'Chillers',
  ventilation: 'Ventilation / AHU',
  kitchen_extract: 'Kitchen extract',
  heating: 'Commercial heating / boilers',
  gas: 'Commercial gas',
  controls: 'Controls / BMS',
  electrical: 'Electrical (HVAC)',
  commissioning: 'Commissioning',
};

export const QUALIFICATIONS: Record<string, { name: string; enables?: string[] }> = {
  FGAS_CAT1: { name: 'F-Gas Category I (refrigerant handling)', enables: ['refrigerant'] },
  GAS_SAFE_COMM: { name: 'Gas Safe — commercial (COCN1/CODNCO)', enables: ['gas'] },
  IPAF: { name: 'IPAF (MEWP operator)' },
  PASMA: { name: 'PASMA (mobile towers)' },
  CSCS: { name: 'CSCS card' },
  SSSTS: { name: 'SSSTS site supervisor' },
  DBS: { name: 'Enhanced DBS check' },
  BESA_VENT: { name: 'BESA ventilation hygiene' },
  ELEC_18TH: { name: '18th Edition wiring regulations' },
};

export const ASSET_CATEGORIES = [
  'Split AC',
  'Multi-split AC',
  'VRF outdoor unit',
  'VRF indoor unit',
  'Cassette unit',
  'Ducted unit',
  'Air handling unit',
  'Fan coil unit',
  'Chiller',
  'Air source heat pump',
  'Boiler',
  'Heat recovery unit (MVHR)',
  'Extract fan',
  'Kitchen extract canopy',
  'Condensing unit',
  'Cold room',
  'Refrigerated display',
  'Controls / BMS',
  'Water heater',
  'Other',
];

/** Skills implied by an asset category — used to work out who can attend. */
export const CATEGORY_SKILLS: Record<string, string[]> = {
  'Split AC': ['ac'],
  'Multi-split AC': ['ac'],
  'VRF outdoor unit': ['vrf'],
  'VRF indoor unit': ['vrf'],
  'Cassette unit': ['ac'],
  'Ducted unit': ['ac'],
  'Air handling unit': ['ventilation'],
  'Fan coil unit': ['ac'],
  Chiller: ['chillers'],
  'Air source heat pump': ['heat_pumps'],
  Boiler: ['heating', 'gas'],
  'Heat recovery unit (MVHR)': ['ventilation'],
  'Extract fan': ['ventilation'],
  'Kitchen extract canopy': ['kitchen_extract'],
  'Condensing unit': ['refrigeration'],
  'Cold room': ['refrigeration'],
  'Refrigerated display': ['refrigeration'],
  'Controls / BMS': ['controls'],
  'Water heater': ['heating', 'gas'],
};

// Global Warming Potentials (AR4, as used by UK F-Gas regulation)
export const GWP: Record<string, number> = {
  R22: 1810, // HCFC — no longer permitted for top-up
  R32: 675,
  R134a: 1430,
  R404A: 3922,
  R407A: 2107,
  R407C: 1774,
  R407F: 1825,
  R410A: 2088,
  R417A: 2346,
  R422D: 2729,
  R448A: 1387,
  R449A: 1397,
  R452A: 2140,
  R454B: 466,
  R513A: 631,
  R290: 3,
  R744: 1,
  R1234ze: 7,
  R1234yf: 4,
};

export const PRIORITIES = {
  P1: { label: 'P1 Emergency', description: 'Business-critical failure, safety risk, vulnerable occupants, total loss of heating/cooling to critical area' },
  P2: { label: 'P2 Urgent', description: 'Significant loss of service or partial failure affecting operation' },
  P3: { label: 'P3 Routine', description: 'Single unit fault, comfort issue, workaround available' },
  P4: { label: 'P4 Planned', description: 'Minor issue, can be combined with next planned visit' },
} as const;

export type Priority = keyof typeof PRIORITIES;

export const JOB_KINDS: Record<string, string> = {
  reactive: 'Reactive / breakdown',
  ppm: 'Planned maintenance',
  remedial: 'Remedial works',
  quoted: 'Quoted works',
  installation: 'Installation / project',
  survey: 'Survey',
  warranty: 'Warranty',
  recall: 'Recall (return to fix)',
};

export const HOLD_REASONS: Record<string, string> = {
  awaiting_parts: 'Awaiting parts',
  awaiting_quote_approval: 'Awaiting quote approval',
  awaiting_access: 'Awaiting access',
  awaiting_customer: 'Awaiting customer',
  awaiting_subcontractor: 'Awaiting subcontractor',
  other: 'Other',
};

export const VISIT_OUTCOMES: Record<string, string> = {
  fixed: 'Fixed — job complete',
  ppm_complete: 'Planned maintenance complete',
  temporary_fix: 'Temporary fix — further work needed',
  further_visit: 'Further visit required',
  parts_required: 'Parts required',
  quote_required: 'Quote required',
  no_access: 'No access',
  no_fault_found: 'No fault found',
};

export const DEFAULT_SLA = {
  P1: { response_hours: 8, fix_hours: 24, basis: 'business' },
  P2: { response_hours: 16, fix_hours: 40, basis: 'business' },
  P3: { response_hours: 40, fix_hours: 80, basis: 'business' },
  P4: { response_hours: 80, fix_hours: null, basis: 'business' },
} as const;

export const DEFAULT_RATES = {
  labour_normal: 68, // per hour, Mon–Fri 08:00–17:30
  labour_overtime: 102, // evenings / Saturday
  labour_sunday_bh: 136,
  callout_normal: 95,
  callout_ooh: 185,
  apprentice: 38,
  mileage_per_mile: 0.65,
  materials_markup_pct: 30,
  vat_pct: 20,
};
