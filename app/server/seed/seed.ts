import '../lib/time.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, db, insert, openDb, q, setDb, setSetting, update, type Row } from '../db/index.ts';
import { DEFAULT_RATES, DEFAULT_SLA, CATEGORY_SKILLS, type Priority } from '../lib/domain.ts';
import { addDays, addMonths, at, isWorkingDay, parseYmd, today, ymd } from '../lib/time.ts';
import { hashPassword } from '../services/auth.ts';
import { slaTargets, contractForSite } from '../services/sla.ts';
import { CHECKLISTS, CUSTOMERS, ENGINEERS, PARTS, SUBCONTRACTORS, SUPPLIERS, USERS } from './data.ts';

// Deterministic PRNG so demo data is stable between reseeds
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20110301);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

const DEMO_PASSWORD = 'frostline';

const workingDayOnOrAfter = (d: Date) => {
  let x = new Date(d);
  while (!isWorkingDay(x)) x = addDays(x, 1);
  return x;
};
const workingDayBefore = (d: Date, n = 1) => {
  let x = new Date(d);
  let count = 0;
  while (count < n) {
    x = addDays(x, -1);
    if (isWorkingDay(x)) count++;
  }
  return x;
};
const workingDayAfter = (d: Date, n = 1) => {
  let x = new Date(d);
  let count = 0;
  while (count < n) {
    x = addDays(x, 1);
    if (isWorkingDay(x)) count++;
  }
  return x;
};
const dt = (day: Date, hhmm: string) => at(ymd(day), hhmm);

export function seed() {
  const now = new Date();
  const base = workingDayOnOrAfter(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const baseIsToday = ymd(base) === today();
  const prevDay = workingDayBefore(base);
  const nextDay = workingDayAfter(base);

  const ids = {
    users: {} as Record<string, number>,
    engineers: {} as Record<string, number>,
    suppliers: {} as Record<string, number>,
    parts: {} as Record<string, number>,
    customers: {} as Record<string, number>,
    sites: {} as Record<string, number>,
    assets: {} as Record<string, number>, // siteKey:tag
    checklists: {} as Record<string, number>,
    vans: {} as Record<string, number>,
    contracts: {} as Record<string, number>,
  };

  const seq: Record<string, number> = { job: 0, quote: 0, po: 0, contract: 0, customer: 0 };
  const nextNo = (name: string, prefix: string, pad: number) => `${prefix}${String(++seq[name]).padStart(pad, '0')}`;

  q.tx(() => {
    setSetting('rates', DEFAULT_RATES);
    setSetting('default_sla', DEFAULT_SLA);

    // ─── Users & engineers ────────────────────────────────────────────────
    const pw = hashPassword(DEMO_PASSWORD);
    for (const u of USERS) ids.users[u.key] = insert('users', { name: u.name, email: u.email, password_hash: pw, role: u.role, job_title: u.job_title, phone: `07700 90${between(1000, 9999)}` });

    const depot = insert('stock_locations', { name: 'Bury depot stores', kind: 'depot' });
    for (const e of ENGINEERS) {
      const first = e.name.split(' ')[0].toLowerCase();
      const last = e.name.split(' ').slice(1).join('').toLowerCase();
      const userId = insert('users', { name: e.name, email: `${first}.${last}@frostline.co.uk`, password_hash: pw, role: 'engineer', job_title: e.grade === 'apprentice' ? 'Apprentice Engineer' : `${e.grade === 'senior' ? 'Senior ' : e.grade === 'lead' ? 'Lead ' : ''}${e.team === 'installation' ? 'Installation' : 'Service'} Engineer`, phone: `07700 91${between(1000, 9999)}` });
      ids.users[e.key] = userId;
      const eid = insert('engineers', {
        user_id: userId,
        name: e.name,
        kind: 'employee',
        grade: e.grade,
        team: e.team,
        phone: `07700 91${between(1000, 9999)}`,
        email: `${first}.${last}@frostline.co.uk`,
        home_postcode: e.postcode,
        home_lat: e.lat,
        home_lng: e.lng,
        van_reg: e.van,
        skills: JSON.stringify(e.skills),
        colour: e.colour,
        hourly_cost: e.grade === 'apprentice' ? 14 : e.grade === 'engineer' ? 27 : 32,
        day_start: e.team === 'installation' ? '07:30' : '08:00',
        day_end: e.team === 'installation' ? '16:30' : '16:30',
        notes: e.key === 'josh' ? 'Apprentice (year 2) — attends with Dave Whittaker. Not to be dispatched alone.' : e.key === 'imran' ? 'Joined from Calder Cooling Services (2021). Covers West Yorkshire.' : e.key === 'nathan' ? 'Covers Merseyside & Cheshire West.' : null,
      });
      ids.engineers[e.key] = eid;
      for (const [code, days] of e.quals) {
        const expires = days === null ? null : ymd(addDays(now, days));
        insert('engineer_qualifications', { engineer_id: eid, code, name: code.replace(/_/g, ' '), reference: `${code.slice(0, 3)}-${between(100000, 999999)}`, issued_on: ymd(addDays(now, -(1000 - (days ?? 0)))), expires_on: expires });
      }
      if (e.van) ids.vans[e.key] = insert('stock_locations', { name: `Van ${e.van} (${e.name.split(' ')[0]})`, kind: 'van', engineer_id: eid });
    }
    const qualNames: Record<string, string> = { FGAS_CAT1: 'F-Gas Category I', GAS_SAFE_COMM: 'Gas Safe — commercial', IPAF: 'IPAF MEWP 3a/3b', PASMA: 'PASMA towers', CSCS: 'CSCS Gold card', SSSTS: 'SSSTS', DBS: 'Enhanced DBS', BESA_VENT: 'BESA ventilation hygiene', ELEC_18TH: '18th Edition' };
    q.run(`UPDATE engineer_qualifications SET name = CASE code ${Object.entries(qualNames).map(([k, v]) => `WHEN '${k}' THEN '${v}'`).join(' ')} ELSE name END`);
    for (const s of SUBCONTRACTORS) {
      const eid = insert('engineers', { name: s.name, kind: 'subcontractor', company: s.company, grade: s.grade, team: 'service', phone: '07700 92' + between(1000, 9999), home_postcode: s.postcode, home_lat: s.lat, home_lng: s.lng, skills: JSON.stringify(s.skills), colour: s.colour, hourly_cost: 45, notes: 'Approved subcontractor — commercial gas. Day rate £360.' });
      ids.engineers[s.key] = eid;
      for (const [code, days] of s.quals) insert('engineer_qualifications', { engineer_id: eid, code, name: qualNames[code], expires_on: ymd(addDays(now, days)) });
    }

    // Absences & on-call
    const weekStart = addDays(base, -((base.getDay() + 6) % 7));
    insert('absences', { engineer_id: ids.engineers.nathan, kind: 'holiday', starts_at: dt(weekStart, '00:00').toISOString(), ends_at: dt(addDays(weekStart, 4), '23:59').toISOString(), notes: 'Annual leave' });
    const trainingDay = workingDayAfter(base, 2);
    insert('absences', { engineer_id: ids.engineers.jason, kind: 'training', starts_at: dt(trainingDay, '08:00').toISOString(), ends_at: dt(trainingDay, '16:30').toISOString(), notes: 'Mitsubishi Ecodan installer course (Livingston)' });
    insert('absences', { engineer_id: ids.engineers.craig, kind: 'holiday', starts_at: dt(workingDayAfter(base, 6), '00:00').toISOString(), ends_at: dt(workingDayAfter(base, 8), '23:59').toISOString(), notes: 'Leave' });
    insert('on_call', { engineer_id: ids.engineers.dave, starts_on: ymd(weekStart), ends_on: ymd(addDays(weekStart, 6)) });
    insert('on_call', { engineer_id: ids.engineers.craig, starts_on: ymd(addDays(weekStart, 7)), ends_on: ymd(addDays(weekStart, 13)) });
    insert('on_call', { engineer_id: ids.engineers.sam, starts_on: ymd(addDays(weekStart, -7)), ends_on: ymd(addDays(weekStart, -1)) });

    // ─── Suppliers, parts & stock ─────────────────────────────────────────
    for (const s of SUPPLIERS) {
      const { key, ...rest } = s;
      ids.suppliers[key] = insert('suppliers', { ...rest, address: 'Greater Manchester' });
    }
    for (const [sku, name, category, unit, cost, sell, sup, dep, van] of PARTS) {
      const pid = insert('parts', { sku, name, category, unit, unit_cost: cost, sell_price: sell, preferred_supplier_id: ids.suppliers[sup], supplier_code: `${sup.toUpperCase().slice(0, 3)}-${between(10000, 99999)}` });
      ids.parts[sku] = pid;
      insert('stock_levels', { part_id: pid, location_id: depot, qty: dep[0], min_qty: dep[1], max_qty: dep[2] });
      if (van) {
        for (const [ek, loc] of Object.entries(ids.vans)) {
          const eng = ENGINEERS.find((x) => x.key === ek)!;
          const relevant = category !== 'Refrigeration' || (eng.skills as readonly string[]).includes('refrigeration');
          if (!relevant) continue;
          const qty = Math.max(0, van[2] - between(0, van[2]));
          insert('stock_levels', { part_id: pid, location_id: loc, qty, min_qty: van[1], max_qty: van[2] });
        }
      }
    }

    // ─── Checklists ───────────────────────────────────────────────────────
    for (const c of CHECKLISTS) ids.checklists[c.key] = insert('checklist_templates', { name: c.name, items: JSON.stringify(c.items) });

    // ─── Customers, contacts, sites, assets ───────────────────────────────
    for (const c of CUSTOMERS) {
      ids.customers[c.key] = insert('customers', {
        account_no: nextNo('customer', 'FL', 4),
        name: c.name,
        kind: c.kind,
        sector: c.sector,
        status: c.status ?? 'active',
        on_stop: c.on_stop ? 1 : 0,
        on_stop_reason: c.on_stop ?? null,
        phone: c.phone,
        email: c.email,
        billing_address: c.billing_address,
        billing_postcode: c.billing_postcode,
        invoice_email: c.contacts.find((x) => x[4].includes('accounts'))?.[3] ?? c.email,
        payment_terms_days: c.payment_terms_days ?? 30,
        po_required: c.po_required ? 1 : 0,
        account_manager_id: ids.users[c.manager],
        notes: c.notes ?? null,
        source: c.status === 'prospect' ? 'Website enquiry' : c.key === 'calderbrook' ? 'Calder Cooling acquisition (2021)' : 'Referral',
        created_at: addDays(now, -between(200, 3000)).toISOString(),
      });
      c.contacts.forEach(([name, title, phone, email, roles], i) => insert('contacts', { customer_id: ids.customers[c.key], name, job_title: title, phone, email, roles: JSON.stringify(roles), is_primary: i === 0 ? 1 : 0 }));
    }
    for (const c of CUSTOMERS) {
      for (const s of c.sites) {
        const sid = insert('sites', {
          customer_id: ids.customers[c.key],
          end_client_id: s.end_client ? ids.customers[s.end_client] : null,
          name: s.name,
          site_code: s.key.toUpperCase().slice(0, 10),
          address: s.address,
          town: s.town,
          county: s.county,
          postcode: s.postcode,
          lat: s.lat,
          lng: s.lng,
          building_type: s.building_type,
          opening_hours: s.opening_hours ?? null,
          access_notes: s.access_notes ?? null,
          parking_notes: s.parking_notes ?? null,
          hazards: s.hazards ?? null,
          induction_required: s.induction ? 1 : 0,
          permit_to_work: s.permit ? 1 : 0,
          dbs_required: s.dbs ? 1 : 0,
          ooh_access: s.ooh_access ?? null,
        });
        ids.sites[s.key] = sid;
        if (s.contact) insert('contacts', { customer_id: ids.customers[c.key], site_id: sid, name: s.contact[0], job_title: s.contact[1], phone: s.contact[2], email: s.contact[3], roles: JSON.stringify(['site']) });
        for (const [tag, category, make, model, location, year, refrigerant, kg, kw, condition] of s.assets) {
          const installed = `${year}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`;
          ids.assets[`${s.key}:${tag}`] = insert('assets', {
            site_id: sid,
            tag,
            category,
            manufacturer: make,
            model,
            serial_number: `${make.slice(0, 2).toUpperCase()}${year % 100}${between(100000, 999999)}`,
            location,
            install_date: installed,
            installed_by_us: rand() > 0.5 ? 1 : 0,
            warranty_expires: year >= 2023 ? addMonths(installed, 36) : null,
            refrigerant,
            refrigerant_kg: kg,
            capacity_kw: kw,
            fuel: category === 'Boiler' || category === 'Water heater' || model.includes('gas') ? 'Natural gas' : 'Electric',
            leak_detection: kg && kg > 20 ? 1 : 0,
            status: 'operational',
            condition: condition ?? (year < 2014 ? 'poor' : year < 2018 ? 'fair' : 'good'),
            notes: refrigerant === 'R22' ? 'R22 system — cannot be topped up. Replacement recommended.' : null,
          });
        }
      }
    }
    // Indoor units hang off their VRF outdoor unit
    q.run(`UPDATE assets SET parent_asset_id = ? WHERE id IN (?, ?)`, ids.assets['harlow:VRF-01'], ids.assets['harlow:FCU-3F-01'], ids.assets['harlow:FCU-3F-02']);
    q.run(`UPDATE assets SET parent_asset_id = ? WHERE id IN (?, ?)`, ids.assets['staidans-high:VRF-01'], ids.assets['staidans-high:CAS-LAB1'], ids.assets['staidans-high:CAS-LAB2']);
    // Warranty-soon example
    update('assets', ids.assets['nff-radcliffe:CU-01'], { warranty_expires: ymd(addDays(now, 40)) });

    // ─── Contracts ────────────────────────────────────────────────────────
    const SLA_COMP = [
      ['P1', 4, 12, '24x7'],
      ['P2', 8, 24, 'business'],
      ['P3', 16, 48, 'business'],
      ['P4', 40, null, 'business'],
    ] as const;
    const SLA_STD = [
      ['P1', 6, 24, '24x7'],
      ['P2', 8, 32, 'business'],
      ['P3', 24, 72, 'business'],
      ['P4', 72, null, 'business'],
    ] as const;
    const SLA_BUS = [
      ['P1', 8, 24, 'business'],
      ['P2', 16, 40, 'business'],
      ['P3', 24, 72, 'business'],
      ['P4', 72, null, 'business'],
    ] as const;
    const contract = (key: string, customer: string, name: string, level: string, startDaysAgo: number, value: number, sites: string[], sla: readonly (readonly [string, number, number | null, string])[] | null, opts: Row = {}) => {
      const starts = ymd(addDays(now, -startDaysAgo));
      const cid = insert('contracts', {
        ref: nextNo('contract', 'MC-', 4),
        customer_id: ids.customers[customer],
        name,
        level,
        status: opts.status ?? 'active',
        starts_on: starts,
        ends_on: opts.ends_on ?? addMonths(starts, 12),
        annual_value: value,
        billing_cycle: opts.billing_cycle ?? 'quarterly',
        ooh_cover: opts.ooh ? 1 : 0,
        labour_included: level === 'ppm_only' ? 0 : opts.labour === false ? 0 : 1,
        parts_included: level === 'comprehensive' ? 1 : 0,
        parts_limit: level === 'comprehensive' ? (opts.parts_limit ?? 300) : null,
        auto_renew: opts.auto_renew ? 1 : 0,
        notice_days: 90,
        account_manager_id: ids.users[CUSTOMERS.find((c) => c.key === customer)!.manager],
        notes: opts.notes ?? null,
        created_at: addDays(now, -startDaysAgo - 14).toISOString(),
      });
      for (const s of sites) insert('contract_sites', { contract_id: cid, site_id: ids.sites[s] });
      for (const [p, r, f, b] of sla ?? []) insert('contract_sla', { contract_id: cid, priority: p, response_hours: r, fix_hours: f, basis: b });
      ids.contracts[key] = cid;
      return cid;
    };
    contract('pennine', 'pennine', 'Pennine portfolio — comprehensive HVAC maintenance', 'comprehensive', 295, 18400, ['harlow', 'quayview', 'kingsway'], SLA_COMP, { ooh: true, parts_limit: 250, notes: 'Parts up to £250 per job included. Excludes R22 system replacement and damage by tenants.' });
    contract('brightwater', 'brightwater', 'Brightwater care homes — PPM & reactive', 'ppm_reactive', 150, 14200, ['oakfield', 'meadowbank', 'willows'], SLA_COMP, { ooh: true, auto_renew: true, labour: true, notes: 'Heating/hot water loss is always P1. Reactive labour included; parts chargeable at list less 10%.' });
    contract('nff', 'nff', 'Northern Fresh — refrigeration & AC comprehensive', 'comprehensive', 60, 21600, ['nff-bury', 'nff-prestwich', 'nff-radcliffe'], SLA_COMP, { ooh: true, parts_limit: 400, billing_cycle: 'monthly', notes: 'Temperature-critical. Work outside trading hours preferred. Parts up to £400/job included.' });
    contract('staidans', 'staidans', "St Aidan's Trust — planned maintenance", 'ppm_only', 340, 6850, ['hollins', 'staidans-high'], null, { billing_cycle: 'annually', notes: 'PPM only. Reactive call-outs chargeable at standard rates against Trust PO.' });
    contract('deansgate', 'deansgate', 'Deansgate Hotel — mechanical maintenance', 'ppm_reactive', 210, 16900, ['deansgate-hotel'], SLA_STD, { ooh: true, notes: 'Kitchen extract failures during service = P1.' });
    contract('calderbrook', 'calderbrook', 'Calderbrook Works — HVAC & process cooling', 'ppm_reactive', 120, 5400, ['calderbrook-works'], SLA_BUS, { notes: 'Transferred from Calder Cooling Services. No OOH cover.' });
    contract('kestrel', 'kestrel', 'Kestrel FM — Lancashire Retail Parks HVAC', 'ppm_reactive', 320, 9800, ['deepdale', 'whitebirk'], SLA_BUS, { billing_cycle: 'monthly', notes: 'Kestrel WO number mandatory. Job sheets to Kestrel portal within 48h.' });
    contract('ribble', 'ribble', 'Holden Mill — refrigeration PPM', 'ppm_only', 180, 2100, ['holden-mill'], null, { billing_cycle: 'annually' });
    contract('mersey-old', 'mersey', 'Knowsley DC — PPM (lapsed)', 'ppm_reactive', 430, 4200, ['knowsley'], SLA_BUS, { status: 'expired', ends_on: ymd(addDays(now, -65)), notes: 'Customer did not renew — cost review. Renewal proposal issued.' });

    // ─── PPM plans ────────────────────────────────────────────────────────
    const plans: Row[] = [];
    const plan = (contractKey: string, siteKey: string, name: string, freq: number, hours: number, skills: string[], checklist: string, assetTags: string[], dueOffsetDays: number, preferred?: string, notes?: string) => {
      const pid = insert('ppm_plans', {
        contract_id: ids.contracts[contractKey],
        site_id: ids.sites[siteKey],
        name,
        frequency_months: freq,
        est_hours: hours,
        required_skills: JSON.stringify(skills),
        checklist_template_id: ids.checklists[checklist],
        next_due_on: ymd(addDays(now, dueOffsetDays)),
        preferred_engineer_id: preferred ? ids.engineers[preferred] : null,
        scheduling_notes: notes ?? null,
      });
      for (const t of assetTags) insert('ppm_plan_assets', { plan_id: pid, asset_id: ids.assets[`${siteKey}:${t}`] });
      plans.push({ id: pid, contractKey, siteKey, name, freq, hours, skills, checklist, assetTags, due: ymd(addDays(now, dueOffsetDays)), preferred });
      return pid;
    };
    plan('pennine', 'harlow', 'Quarterly VRF & AC service', 3, 6, ['vrf', 'ac'], 'ac', ['VRF-01', 'VRF-02', 'FCU-3F-01', 'FCU-3F-02', 'SPL-COMMS', 'SPL-8F'], 0, 'dave', 'Roof work — permit from building manager 48h ahead.');
    plan('pennine', 'harlow', '6-monthly AHU service & filter change', 6, 3, ['ventilation'], 'ahu', ['AHU-01'], 24, 'chloe');
    plan('pennine', 'harlow', 'Annual boiler service', 12, 3, ['heating', 'gas'], 'boiler', ['BLR-01'], 38, 'craig', 'Before heating season.');
    plan('pennine', 'quayview', '6-monthly AC & MVHR service', 6, 4, ['ac'], 'ac', ['MS-01', 'MS-02', 'CAS-GF-01', 'MVHR-01'], 0, 'sam');
    plan('pennine', 'kingsway', '6-monthly AC & heat pump service', 6, 3, ['ac', 'heat_pumps'], 'ac', ['DUCT-01', 'HP-01'], 12, 'jason');
    plan('brightwater', 'oakfield', 'Annual boiler & water heater service', 12, 5, ['heating', 'gas'], 'boiler', ['BLR-01', 'BLR-02', 'CWH-01'], 0, 'craig', 'Keep one boiler running at all times.');
    plan('brightwater', 'oakfield', '6-monthly ventilation & kitchen extract', 6, 3, ['ventilation', 'kitchen_extract'], 'ahu', ['EXT-KIT', 'MVHR-EAST'], -6, 'chloe', 'Kitchen extract only 14:00–16:00 (between meal services).');
    plan('brightwater', 'meadowbank', 'Annual boiler service', 12, 3, ['heating', 'gas'], 'boiler', ['BLR-01', 'BLR-02'], 0, 'craig');
    plan('brightwater', 'willows', 'Quarterly cold room service', 3, 2, ['refrigeration'], 'refrig', ['CR-KIT'], 0, 'lee');
    plan('brightwater', 'willows', 'Annual boiler & AHU service', 12, 5, ['heating', 'gas', 'ventilation'], 'boiler', ['BLR-01', 'AHU-01'], 45, 'craig');
    for (const store of ['nff-bury', 'nff-prestwich', 'nff-radcliffe']) {
      const tags = CUSTOMERS.find((c) => c.key === 'nff')!.sites.find((s) => s.key === store)!.assets.map((a) => a[0]);
      plan('nff', store, 'Quarterly refrigeration & AC service', 3, 4, ['refrigeration'], 'refrig', tags, store === 'nff-bury' ? 0 : store === 'nff-prestwich' ? 9 : 16, store === 'nff-bury' ? 'dave' : 'lee', 'Before 10:00 or after 20:00 on shop floor.');
    }
    plan('staidans', 'hollins', 'Annual boiler service', 12, 3, ['heating', 'gas'], 'boiler', ['BLR-01'], 41, 'craig', 'October half-term preferred.');
    plan('staidans', 'hollins', '6-monthly AC & kitchen extract service', 6, 3, ['ac', 'kitchen_extract'], 'ac', ['SPL-ICT', 'EXT-KIT'], 0, 'chloe', 'Kitchen extract after 14:00 (lunch service).');
    plan('staidans', 'staidans-high', '6-monthly VRF, AHU & AC service', 6, 7, ['vrf', 'ventilation'], 'ac', ['AHU-SH', 'VRF-01', 'CAS-LAB1', 'CAS-LAB2', 'SPL-SRV'], 5, 'sam', 'Sports hall AHU — not during exams (check with facilities).');
    plan('staidans', 'staidans-high', 'Annual boiler service', 12, 4, ['heating', 'gas'], 'boiler', ['BLR-01'], 39, 'paul', 'Subcontract to Rigby Gas.');
    plan('deansgate', 'deansgate-hotel', 'Quarterly chiller & AHU service', 3, 6, ['chillers', 'ventilation'], 'ahu', ['CH-01', 'AHU-01', 'AHU-02'], 0, 'chloe');
    plan('deansgate', 'deansgate-hotel', 'Quarterly cold room service', 3, 2, ['refrigeration'], 'refrig', ['CR-01', 'CR-02'], 7, 'lee', 'Kitchen stores — after 15:00.');
    plan('deansgate', 'deansgate-hotel', '6-monthly kitchen extract clean & service', 6, 4, ['kitchen_extract'], 'ahu', ['EXT-KIT'], -12, 'chloe', 'Overnight only (kitchen closes 23:00).');
    plan('calderbrook', 'calderbrook-works', 'Quarterly process chiller & AC service', 3, 4, ['chillers', 'ac'], 'refrig', ['PCH-01', 'SPL-OFF1', 'SPL-QA'], 20, 'imran');
    plan('kestrel', 'deepdale', '6-monthly VRF service', 6, 5, ['vrf'], 'ac', ['VRF-U5', 'VRF-U7', 'AC-MALL'], 30, 'sam', 'Kestrel WO required before visit.');
    plan('kestrel', 'whitebirk', '6-monthly AC service', 6, 2, ['ac'], 'ac', ['CAS-01', 'CAS-02'], 3, 'jason');
    plan('ribble', 'holden-mill', '6-monthly refrigeration service', 6, 4, ['refrigeration', 'chillers'], 'refrig', ['GLY-01', 'CR-01', 'CEL-01'], 0, 'imran');
  });

  // ─── helpers bound to seed scope ────────────────────────────────────────
  function ppmSummary(name: string) {
    return pick([
      `${name} completed to checklist. Filters cleaned, coils cleaned, condensate drains flushed, electrical connections checked, leak check carried out — no leaks. All units operating correctly.`,
      `${name} carried out. All equipment inspected and tested; readings recorded on checklist. No defects found.`,
      `${name} complete. Minor: condensate pump on one unit noisy but working — monitor at next visit. Otherwise all plant in good working order.`,
    ]);
  }

  class JobFactory {
    constructor(
      private ids: any,
      private now: Date,
    ) {}
    asset(site: string, tag: string) {
      return this.ids.assets[`${site}:${tag}`] as number;
    }
    van(engineerId: number) {
      return q.get<Row>('SELECT id FROM stock_locations WHERE engineer_id = ?', engineerId)?.id ?? null;
    }
    engineerFor(skills: string[], siteKey?: string) {
      const west = siteKey && ['knowsley'].includes(siteKey);
      const yorks = siteKey && ['calderbrook-works'].includes(siteKey);
      if (west && rand() < 0.7) return this.ids.engineers.nathan;
      if (yorks && rand() < 0.8) return this.ids.engineers.imran;
      const pool = q.all<Row>(`SELECT id, skills FROM engineers WHERE kind = 'employee' AND grade != 'apprentice' AND team = 'service'`).filter((e) => skills.some((s) => JSON.parse(e.skills).includes(s)));
      return (pool.length ? pick(pool) : { id: this.ids.engineers.dave }).id as number;
    }
    job(o: { site_id: number; kind: string; priority: Priority; title: string; description?: string; created: Date; assets: number[]; reported_via: string; reported_by?: string; customer_ref?: string; nte_limit?: number; ppm_plan_id?: number; due_on?: string; target_start_on?: string; est_hours?: number; quote_id?: number; charge_type?: string; skills?: string[]; parent_job_id?: number }) {
      const site = q.get<Row>('SELECT * FROM sites WHERE id = ?', o.site_id)!;
      const c = contractForSite(site.id, ymd(o.created)) ?? (o.kind === 'ppm' ? q.get<Row>('SELECT c.* FROM ppm_plans p JOIN contracts c ON c.id = p.contract_id WHERE p.id = ?', o.ppm_plan_id ?? -1) : undefined);
      const sla = ['reactive', 'warranty', 'recall'].includes(o.kind) ? slaTargets(c?.id, o.priority, o.created) : null;
      const skills = o.skills ?? [...new Set(o.assets.flatMap((a) => CATEGORY_SKILLS[q.get<Row>('SELECT category FROM assets WHERE id = ?', a)!.category] ?? []))];
      const charge = o.charge_type ?? (o.kind === 'ppm' ? 'contract' : o.kind === 'recall' ? 'non_chargeable' : o.kind === 'warranty' ? 'warranty' : c && c.level !== 'ppm_only' && c.labour_included ? 'contract' : 'chargeable');
      const jobNo = nextNo('job', 'J-', 5);
      const id = insert('jobs', {
        job_no: jobNo,
        customer_id: site.customer_id,
        site_id: site.id,
        contract_id: c?.id ?? null,
        kind: o.kind,
        priority: o.priority,
        status: 'new',
        title: o.title,
        description: o.description ?? null,
        reported_by: o.reported_by ?? null,
        reported_via: o.reported_via,
        customer_ref: o.customer_ref ?? null,
        nte_limit: o.nte_limit ?? null,
        charge_type: charge,
        quote_id: o.quote_id ?? null,
        ppm_plan_id: o.ppm_plan_id ?? null,
        parent_job_id: o.parent_job_id ?? null,
        required_skills: JSON.stringify(skills),
        est_hours: o.est_hours ?? 2,
        due_on: o.due_on ?? null,
        target_start_on: o.target_start_on ?? null,
        respond_by: sla?.respond_by ?? null,
        fix_by: sla?.fix_by ?? null,
        invoice_status: ['non_chargeable', 'warranty'].includes(charge) ? 'not_chargeable' : 'not_ready',
        logged_by: this.ids.users[pick(['rachel', 'priya', 'tom'])],
        created_at: o.created.toISOString(),
        updated_at: o.created.toISOString(),
      });
      for (const a of o.assets) insert('job_assets', { job_id: id, asset_id: a });
      insert('job_notes', { job_id: id, user_id: null, kind: 'system', body: `Job logged (${o.kind}, ${o.priority}) via ${o.reported_via}`, created_at: o.created.toISOString() });
      return { id, job_no: jobNo, created: o.created, kind: o.kind, charge_type: charge };
    }
    visit(job: Row, engineerId: number, start: Date, hours: number, o: { outcome?: string; summary?: string; checklist?: number; scheduledOnly?: boolean; instructions?: string }) {
      const end = new Date(start.getTime() + hours * 3600_000);
      const vid = insert('visits', { job_id: job.id, engineer_id: engineerId, starts_at: start.toISOString(), ends_at: end.toISOString(), status: 'scheduled', instructions: o.instructions ?? null, created_at: new Date(Math.min(job.created.getTime() + 20 * 60_000, start.getTime())).toISOString() });
      pending.set(vid, { ...o, start, end, job, engineerId });
      if (o.scheduledOnly || start > this.now) update('jobs', job.id, { status: 'scheduled' });
      return vid;
    }
    /** Mark a past visit as done with its planned outcome. */
    visitDone(vid: number) {
      const p = pending.get(vid)!;
      const arrive = new Date(p.start.getTime() + between(-5, 15) * 60_000);
      const depart = new Date(p.end.getTime() + between(-20, 25) * 60_000);
      const finished = ['fixed', 'ppm_complete', 'no_fault_found'].includes(p.outcome);
      update('visits', vid, { status: finished ? 'completed' : 'incomplete', travel_started_at: new Date(arrive.getTime() - between(15, 45) * 60_000).toISOString(), arrived_at: arrive.toISOString(), departed_at: depart.toISOString(), outcome: p.outcome, work_summary: p.summary, signed_by: finished ? pick(['J. Smith', 'Site manager', 'K. Patel', 'Duty manager', 'A. Brown']) : null });
      const eng = q.get<Row>('SELECT user_id FROM engineers WHERE id = ?', p.engineerId)!;
      insert('job_notes', { job_id: p.job.id, visit_id: vid, user_id: eng.user_id, kind: 'engineer', body: `Visit completed — ${String(p.outcome).replace(/_/g, ' ')}: ${p.summary}`, created_at: depart.toISOString() });
      if (p.checklist) {
        const tpl = q.get<Row>('SELECT items FROM checklist_templates WHERE id = ?', p.checklist)!;
        const responses: Row = {};
        for (const it of JSON.parse(tpl.items)) responses[it.key] = it.kind === 'check' ? true : it.kind === 'reading' ? readingFor(it.key) : '';
        insert('visit_checklists', { visit_id: vid, template_id: p.checklist, responses: JSON.stringify(responses) });
      }
      const job = q.get<Row>('SELECT attended_at FROM jobs WHERE id = ?', p.job.id)!;
      if (!job.attended_at) update('jobs', p.job.id, { attended_at: arrive.toISOString() });
      return { arrive, depart };
    }
    /** A visit today: status depends on the real clock. */
    liveVisit(job: Row, engineerId: number, start: Date, hours: number, o: { outcome: string; summary: string; cause?: string; part?: string; checklist?: number; keepOpen?: boolean }) {
      const vid = this.visit(job, engineerId, start, hours, o);
      const end = new Date(start.getTime() + hours * 3600_000);
      if (end <= this.now && !o.keepOpen) {
        if (o.part) this.part(job, o.part, 1, this.van(engineerId), vid);
        this.complete(job, vid, o.cause);
      } else if (start <= this.now) {
        update('visits', vid, { status: 'on_site', travel_started_at: new Date(start.getTime() - 30 * 60_000).toISOString(), arrived_at: new Date(start.getTime() + 6 * 60_000).toISOString() });
        const j = q.get<Row>('SELECT attended_at FROM jobs WHERE id = ?', job.id)!;
        update('jobs', job.id, { status: 'in_progress', attended_at: j.attended_at ?? new Date(start.getTime() + 6 * 60_000).toISOString() });
      } else if (start.getTime() - this.now.getTime() < 45 * 60_000) {
        update('visits', vid, { status: 'travelling', travel_started_at: new Date(this.now.getTime() - 10 * 60_000).toISOString() });
      } else {
        update('visits', vid, { status: rand() < 0.6 ? 'accepted' : 'scheduled' });
      }
      return vid;
    }
    complete(job: Row, vid: number, cause?: string) {
      const { depart } = this.visitDone(vid);
      const p = pending.get(vid)!;
      update('jobs', job.id, { status: 'completed', completed_at: depart.toISOString(), resolution: p.summary, cause: cause ?? null, updated_at: depart.toISOString() });
    }
    close(job: Row, invoiced: boolean) {
      const j = q.get<Row>('SELECT * FROM jobs WHERE id = ?', job.id)!;
      const closedAt = new Date(new Date(j.completed_at).getTime() + between(1, 5) * 86400_000);
      if (closedAt > this.now) return;
      const chargeable = ['chargeable', 'quoted'].includes(j.charge_type);
      update('jobs', job.id, {
        status: 'closed',
        closed_at: closedAt.toISOString(),
        invoice_status: chargeable ? (invoiced ? 'invoiced' : 'ready') : 'not_chargeable',
        invoice_ref: chargeable && invoiced ? `INV-${between(24000, 26999)}` : null,
        invoice_value: chargeable && invoiced ? between(180, 1400) : null,
      });
    }
    part(job: Row, sku: string, qty: number, locationId: number | null, visitId?: number) {
      const p = q.get<Row>('SELECT * FROM parts WHERE sku = ?', sku)!;
      insert('job_parts', { job_id: job.id, visit_id: visitId ?? null, part_id: p.id, description: p.name, qty, unit_cost: p.unit_cost, unit_price: p.sell_price, location_id: locationId, created_at: (pending.get(visitId!)?.end ?? this.now).toISOString() });
    }
    note(job: Row, body: string, userKey: string) {
      insert('job_notes', { job_id: job.id, user_id: this.ids.users[userKey], kind: 'note', body, created_at: new Date(Math.min(this.now.getTime() - 30 * 60_000, Date.now())).toISOString() });
    }
    defect(job: Row, assetId: number, severity: string, description: string, recommendation: string, visitId?: number) {
      const site = q.get<Row>('SELECT site_id FROM jobs WHERE id = ?', job.id)!;
      return insert('defects', { site_id: site.site_id, asset_id: assetId, job_id: job.id, visit_id: visitId ?? null, severity, description, recommendation, status: 'open', created_at: (visitId ? pending.get(visitId)?.end : undefined)?.toISOString() ?? job.created.toISOString() });
    }
    po(sku: string | null, job: Row | null, created: Date, status: string, lines?: { part?: string; description?: string; qty: number; unit_cost?: number }[], supplierKey?: string, requiredBy?: string, received?: number[]) {
      const ls = lines ?? [{ part: sku!, qty: 1 }];
      const firstPart = ls.find((l) => l.part) ? q.get<Row>('SELECT * FROM parts WHERE sku = ?', ls.find((l) => l.part)!.part)! : null;
      const supplier = supplierKey ? this.ids.suppliers[supplierKey] : (firstPart?.preferred_supplier_id ?? this.ids.suppliers.nwrs);
      const depot = q.get<Row>(`SELECT id FROM stock_locations WHERE kind = 'depot'`)!.id;
      const pid = insert('purchase_orders', { po_no: nextNo('po', 'PO-', 5), supplier_id: supplier, job_id: job?.id ?? null, status, deliver_to: 'depot', location_id: depot, required_by: requiredBy ?? null, ordered_at: status === 'draft' ? null : created.toISOString(), raised_by: this.ids.users.kev, created_at: created.toISOString() });
      ls.forEach((l, i) => {
        const part = l.part ? q.get<Row>('SELECT * FROM parts WHERE sku = ?', l.part)! : null;
        const qtyReceived = status === 'received' ? l.qty : (received?.[i] ?? 0);
        insert('po_lines', { po_id: pid, part_id: part?.id ?? null, description: l.description ?? part!.name, qty: l.qty, qty_received: qtyReceived, unit_cost: l.unit_cost ?? part?.unit_cost ?? 0 });
      });
      return pid;
    }
    quote(o: { customer: string; site: string; kind: string; title: string; status: string; createdDaysAgo: number; sentDaysAgo?: number; decidedDaysAgo?: number; followUpDays?: number; probability?: number; decline?: string; customer_po?: string; prepared: string; scope?: string; lines: (readonly [string, string | null, string, number, number, number])[] }) {
      const created = addDays(this.now, -o.createdDaysAgo);
      const sent = o.sentDaysAgo != null ? addDays(this.now, -o.sentDaysAgo) : o.status !== 'draft' ? addDays(created, 1) : null;
      const qid = insert('quotes', {
        quote_no: nextNo('quote', 'Q-', 5),
        customer_id: this.ids.customers[o.customer],
        site_id: this.ids.sites[o.site],
        contact_id: q.get<Row>('SELECT id FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC LIMIT 1', this.ids.customers[o.customer])?.id ?? null,
        kind: o.kind,
        title: o.title,
        scope: o.scope ?? o.title,
        exclusions: 'Works outside normal hours unless stated. Builders work and making good. Asbestos survey or removal. Electrical supply alterations beyond local isolator. Prices exclude VAT.',
        status: o.status,
        prepared_by: this.ids.users[o.prepared],
        valid_until: ymd(addDays(created, 30)),
        sent_at: sent?.toISOString() ?? null,
        decided_at: o.decidedDaysAgo != null ? addDays(this.now, -o.decidedDaysAgo).toISOString() : null,
        decline_reason: o.decline ?? null,
        customer_po: o.customer_po ?? null,
        follow_up_on: o.followUpDays != null ? ymd(addDays(this.now, o.followUpDays)) : null,
        probability: o.probability ?? null,
        created_at: created.toISOString(),
        updated_at: created.toISOString(),
      });
      o.lines.forEach(([kind, sku, description, qty, cost, price], i) => insert('quote_lines', { quote_id: qid, sort: i, kind, part_id: sku ? this.ids.parts[sku] : null, description, qty, unit_cost: cost, unit_price: price }));
      insert('audit_log', { entity_type: 'quote', entity_id: qid, user_id: this.ids.users[o.prepared], action: 'created', created_at: created.toISOString() });
      if (sent) insert('audit_log', { entity_type: 'quote', entity_id: qid, user_id: this.ids.users[o.prepared], action: 'status_sent', created_at: sent.toISOString() });
      if (o.decidedDaysAgo != null) insert('audit_log', { entity_type: 'quote', entity_id: qid, user_id: this.ids.users[o.prepared], action: `status_${o.status}`, detail: o.decline ?? o.customer_po ?? null, created_at: addDays(this.now, -o.decidedDaysAgo).toISOString() });
      return qid;
    }
  }

  // ─── Jobs, visits & history ────────────────────────────────────────────
  const J = new JobFactory(ids, now);

  q.tx(() => {
    // Historical PPM completions (previous cycle of every plan within last 7 months)
    const planRows = q.all<Row>('SELECT p.*, s.name AS site_name FROM ppm_plans p JOIN sites s ON s.id = p.site_id');
    for (const p of planRows) {
      let due = addMonths(p.next_due_on, -p.frequency_months);
      const past: string[] = [];
      while (due > ymd(addDays(now, -210))) {
        if (due < today()) past.unshift(due);
        due = addMonths(due, -p.frequency_months);
      }
      for (const d of past) {
        const day = workingDayOnOrAfter(addDays(parseYmd(d), -between(0, 9)));
        if (day >= base) continue;
        const assetIds = q.all<{ asset_id: number }>('SELECT asset_id FROM ppm_plan_assets WHERE plan_id = ?', p.id).map((a) => a.asset_id);
        const eng = p.preferred_engineer_id ?? J.engineerFor(JSON.parse(p.required_skills));
        const start = dt(day, pick(['08:00', '08:30', '09:00', '12:30']));
        const job = J.job({ site_id: p.site_id, kind: 'ppm', priority: 'P4', title: p.name, created: addDays(start, -between(10, 20)), assets: assetIds, ppm_plan_id: p.id, due_on: d, est_hours: p.est_hours, reported_via: 'ppm_schedule' });
        const v = J.visit(job, eng, start, p.est_hours, { outcome: 'ppm_complete', summary: ppmSummary(p.name), checklist: p.checklist_template_id });
        J.complete(job, v);
        J.close(job, false);
        for (const aid of assetIds) {
          const a = q.get<Row>('SELECT * FROM assets WHERE id = ?', aid)!;
          const lastService = a.last_serviced_on && a.last_serviced_on > ymd(start) ? a.last_serviced_on : ymd(start);
          const leak = a.refrigerant && a.refrigerant_kg ? { last_leak_check_on: ymd(start) } : {};
          update('assets', aid, { last_serviced_on: lastService, ...leak });
          if (a.refrigerant && a.refrigerant_kg) insert('refrigerant_logs', { asset_id: aid, job_id: job.id, visit_id: v, engineer_id: eng, logged_on: ymd(start), action: 'leak_check', refrigerant: a.refrigerant, qty_kg: 0, leak_found: 0, notes: 'Direct leak check — no leaks found' });
        }
        if (rand() < 0.12 && assetIds.length) J.defect(job, pick(assetIds), 'advisory', 'Condensate tray showing corrosion', 'Monitor; replace tray at next service if worsening');
      }
    }
    // Make some F-Gas checks overdue for the compliance view
    update('assets', J.asset('deansgate-hotel', 'CH-01'), { last_leak_check_on: ymd(addDays(now, -205)) });
    update('assets', J.asset('knowsley', 'CR-01'), { last_leak_check_on: ymd(addDays(now, -410)) });
    update('assets', J.asset('knowsley', 'VRF-OFF'), { last_leak_check_on: ymd(addDays(now, -390)) });
    update('assets', J.asset('holden-mill', 'GLY-01'), { last_leak_check_on: ymd(addDays(now, -350)) });

    // Historical reactive work
    const reactiveSites = ['harlow', 'quayview', 'kingsway', 'oakfield', 'meadowbank', 'willows', 'nff-bury', 'nff-prestwich', 'nff-radcliffe', 'hollins', 'staidans-high', 'deansgate-hotel', 'calderbrook-works', 'knowsley', 'deepdale', 'whitebirk', 'holden-mill', 'knutsford-dental', 'vantage-stockport'];
    for (let i = 0; i < 70; i++) {
      const siteKey = pick(reactiveSites);
      const assets = q.all<Row>('SELECT * FROM assets WHERE site_id = ?', ids.sites[siteKey]);
      if (!assets.length) continue;
      const asset = pick(assets);
      const fault = faultFor(asset.category);
      const daysAgo = between(3, 180);
      let logged = addDays(now, -daysAgo);
      logged.setHours(between(7, 16), between(0, 59), 0, 0);
      if (!isWorkingDay(logged) && fault.priority !== 'P1') logged = dt(workingDayOnOrAfter(logged), '08:40');
      if (logged >= dt(base, '07:00')) continue;
      const skills = CATEGORY_SKILLS[asset.category] ?? ['ac'];
      const eng = J.engineerFor(skills, siteKey);
      const responseH = fault.priority === 'P1' ? between(1, 5) : fault.priority === 'P2' ? between(3, 20) : between(10, 60);
      let start = new Date(logged.getTime() + responseH * 3600_000);
      if (!isWorkingDay(start) && fault.priority !== 'P1') start = dt(workingDayOnOrAfter(start), '09:00');
      if (start.getHours() >= 17 && fault.priority !== 'P1') start = dt(workingDayAfter(start), '09:00');
      if (start >= dt(base, '07:00')) continue;
      const job = J.job({ site_id: ids.sites[siteKey], kind: 'reactive', priority: fault.priority, title: fault.title, description: fault.description, created: logged, assets: [asset.id], reported_via: pick(['phone', 'phone', 'email', 'email', 'web']) });
      const d2 = workingDayAfter(start, between(1, 4));
      const start2 = dt(d2, pick(['09:00', '10:30', '13:00']));
      const twoVisits = rand() < 0.22 && start2 < dt(base, '07:00');
      if (twoVisits) {
        const v1 = J.visit(job, eng, start, 2, { outcome: 'parts_required', summary: fault.first });
        J.visitDone(v1);
        if (fault.part) J.po(fault.part, job, addDays(start, 0.1), 'received');
        const v2 = J.visit(job, eng, start2, 2, { outcome: 'fixed', summary: fault.resolution });
        if (fault.part) J.part(job, fault.part, 1, null, v2);
        J.complete(job, v2, fault.cause);
      } else {
        const v = J.visit(job, eng, start, between(1, 3), { outcome: fault.nff ? 'no_fault_found' : 'fixed', summary: fault.resolution });
        if (fault.part) J.part(job, fault.part, 1, J.van(eng), v);
        if (fault.refrigerantKg && asset.refrigerant && asset.refrigerant !== 'R22') {
          insert('refrigerant_logs', { asset_id: asset.id, job_id: job.id, visit_id: v, engineer_id: eng, logged_on: ymd(start), action: 'added', refrigerant: asset.refrigerant, qty_kg: fault.refrigerantKg, leak_found: 1, notes: 'Leak located and repaired before recharge' });
        }
        J.complete(job, v, fault.cause);
      }
      J.close(job, rand() < 0.85);
    }

    // ─── Current live work ─────────────────────────────────────────────────
    const E = ids.engineers;
    const S = ids.sites;

    // A. Harlow House server room — attended yesterday, R22 unit end of life, quote required
    {
      const logged = dt(workingDayBefore(base, 2), '16:10');
      const job = J.job({ site_id: S.harlow, kind: 'reactive', priority: 'P2', title: '8th floor server room AC tripping — high temperature alarm', description: 'Building manager reports server room temperature alarm at 29°C. Unit keeps tripping out. Portable cooling in place from tenant IT team.', created: logged, assets: [J.asset('harlow', 'SPL-8F')], reported_by: 'Des Morley', reported_via: 'phone', customer_ref: 'WO-PPM-88213' });
      const v = J.visit(job, E.sam, dt(prevDay, '09:00'), 2.5, { outcome: 'quote_required', summary: 'Unit tripping on HP. Condenser coil badly corroded, fan motor bearings noisy, system low on charge (R22 — cannot top up). Reset and cleaned coil as temporary measure; unit running but will not hold in hot weather. Recommend replacement with R32 split system (5kW). Tenant IT keeping portable unit in place.' });
      J.visitDone(v);
      update('jobs', job.id, { status: 'on_hold', hold_reason: 'awaiting_quote_approval', attended_at: dt(prevDay, '09:05').toISOString(), cause: 'End-of-life R22 system, corroded condenser, low charge' });
      J.defect(job, J.asset('harlow', 'SPL-8F'), 'urgent', 'R22 split system at end of life — low refrigerant charge (cannot be topped up), condenser coil corroded, fan motor bearings failing.', 'Replace with new 5kW R32 inverter split (Daikin FTXM50R/RXM50R or equivalent), recover R22 for disposal, new pipework & condensate pump.', v);
      update('assets', J.asset('harlow', 'SPL-8F'), { status: 'faulty' });
      J.note(job, 'Karen Oldfield (Pennine) wants the replacement quote by end of week — tenant is a law firm and server room is critical.', 'rachel');
    }

    // B. Northern Fresh Prestwich — P1 freezer running warm this morning
    {
      const logged = new Date(Math.min(dt(base, '07:40').getTime(), now.getTime() - 5 * 3600_000));
      const job = J.job({ site_id: S['nff-prestwich'], kind: 'reactive', priority: 'P1', title: 'Low-temp freezer case running warm (-12°C)', description: 'Store opened to find 3-door freezer at -12°C (should be -20°C). Ice cream moved to back freezer. Condensing unit on roof running continuously.', created: logged, assets: [J.asset('nff-prestwich', 'FZ-01'), J.asset('nff-prestwich', 'CU-02')], reported_by: 'Store Manager (Prestwich)', reported_via: 'phone' });
      J.liveVisit(job, E.lee, dt(base, '08:30'), 2.5, { outcome: 'fixed', summary: 'Evaporator iced solid — defrost heater termination stat failed. Manual defrost carried out, replaced termination thermostat, checked charge and sight glass clear. Case pulling down, -18°C at departure.', cause: 'Failed defrost termination thermostat', part: 'THERM-10K' });
    }

    // C. Deansgate Hotel — kitchen extract noisy (P2, unscheduled)
    {
      const logged = new Date(Math.max(now.getTime() - 95 * 60_000, dt(base, '08:05').getTime()));
      J.job({ site_id: S['deansgate-hotel'], kind: 'reactive', priority: 'P2', title: 'Kitchen extract fan very noisy / vibrating', description: 'Chief Engineer reports loud rumbling from extract fan above main kitchen canopy since breakfast service. Still running. Worried it will fail before dinner service (starts 17:30).', created: logged > now ? addDays(now, 0) : logged, assets: [J.asset('deansgate-hotel', 'EXT-KIT')], reported_by: 'Marco Rossi', reported_via: 'phone', skills: ['kitchen_extract', 'ventilation'] });
    }

    // D. Calderbrook process chiller — awaiting parts
    let calderJob: Row;
    {
      const logged = dt(workingDayBefore(base, 2), '10:20');
      calderJob = J.job({ site_id: S['calderbrook-works'], kind: 'reactive', priority: 'P2', title: 'Process chiller tripping on high pressure', description: 'Chiller PCH-01 tripping on HP alarm 3–4 times per shift. Production using manual reset. CNC spindle temps rising.', created: logged, assets: [J.asset('calderbrook-works', 'PCH-01')], reported_by: 'Neil Sutcliffe', reported_via: 'email' });
      const v = J.visit(calderJob, E.imran, dt(prevDay, '08:30'), 3, { outcome: 'parts_required', summary: 'Condenser fan 2 motor seized (bearing failure) — chiller losing head pressure control. HP switch contacts also pitted. Condenser coils cleaned. Set chiller to run on reduced capacity with fan 1 only; customer advised to reset if trips. Ordering fan motor & HP switch.' });
      J.visitDone(v);
      update('jobs', calderJob.id, { status: 'on_hold', hold_reason: 'awaiting_parts', attended_at: dt(prevDay, '08:40').toISOString() });
      const poId = J.po(null, calderJob, dt(prevDay, '12:15'), 'ordered', [
        { description: 'Daikin EWAT-B condenser fan motor assembly (EC, 800mm)', qty: 1, unit_cost: 612 },
        { part: 'SW-HP-AUTO', qty: 1 },
      ], 'nwrs', ymd(nextDay));
      J.note(calderJob, `Parts ordered on ${q.get<Row>('SELECT po_no FROM purchase_orders WHERE id = ?', poId)!.po_no} — supplier confirmed next-day delivery to depot. Imran to return once received.`, 'priya');
    }

    // E. Mersey Logistics (no contract) — cold room not holding temp, logged recently
    J.job({ site_id: S.knowsley, kind: 'reactive', priority: 'P2', title: 'Chilled goods cold room not holding temperature (+9°C)', description: 'Bay 3 cold room reading +9°C, set point +3°C. Chilled stock for dispatch tomorrow. Customer PO 4500-22871 raised, NTE £600 without further authorisation.', created: new Date(now.getTime() - 40 * 60_000), assets: [J.asset('knowsley', 'CR-01')], reported_by: 'Joanne Kerr', reported_via: 'phone', customer_ref: '4500-22871', nte_limit: 600 });

    // F. St Aidan's High — sports hall AHU not running (scheduled tomorrow)
    {
      const job = J.job({ site_id: S['staidans-high'], kind: 'reactive', priority: 'P3', title: 'Sports hall AHU not running', description: 'Facilities report sports hall is stuffy, AHU panel shows fault light. PO to follow from Trust.', created: dt(workingDayBefore(base, 3), '11:45'), assets: [J.asset('staidans-high', 'AHU-SH')], reported_by: 'Janet Crompton', reported_via: 'email' });
      J.visit(job, E.chloe, dt(nextDay, '08:30'), 2, { scheduledOnly: true, instructions: 'Sign in at facilities office Gate B. DBS badge visible.' });
    }

    // G. Quay View — reception cassette dripping (scheduled tomorrow afternoon)
    {
      const job = J.job({ site_id: S.quayview, kind: 'reactive', priority: 'P3', title: 'Water dripping from reception cassette', description: 'Drips onto reception desk; bucket in place.', created: dt(prevDay, '14:20'), assets: [J.asset('quayview', 'CAS-GF-01')], reported_by: 'Lucy Grant', reported_via: 'email' });
      J.visit(job, E.sam, dt(nextDay, '14:00'), 1.5, { scheduledOnly: true });
    }

    // H. Whitebirk — rear cassette blowing warm (today afternoon, Kestrel WO)
    {
      const job = J.job({ site_id: S.whitebirk, kind: 'reactive', priority: 'P3', title: 'Rear sales floor cassette blowing warm air', description: 'Kestrel WO-58812. Rear cassette CAS-02 blowing warm, front unit OK. NTE £350.', created: dt(prevDay, '09:30'), assets: [J.asset('whitebirk', 'CAS-02')], reported_by: 'Kestrel Helpdesk', reported_via: 'email', customer_ref: 'WO-58812', nte_limit: 350 });
      J.liveVisit(job, E.jason, dt(base, '13:30'), 2, { outcome: 'fixed', summary: 'Indoor unit coil thermistor reading open circuit — unit not calling for cooling. Replaced thermistor, tested in cooling mode, 11°C off-coil.', cause: 'Failed indoor coil thermistor', part: 'THERM-10K' });
    }

    // I. The Willows — recall: cold room alarm again after last repair
    {
      const prev = J.job({ site_id: S.willows, kind: 'reactive', priority: 'P2', title: 'Kitchen cold room high temp alarm', description: 'Cold room at +8°C.', created: addDays(dt(base, '07:50'), -12), assets: [J.asset('willows', 'CR-KIT')], reported_via: 'phone', reported_by: 'Kitchen Manager' });
      const pv = J.visit(prev, E.lee, addDays(dt(base, '11:00'), -12), 2, { outcome: 'fixed', summary: 'Evaporator fan motor seized. Replaced motor, cleared ice from coil, room pulling down to +3°C.' });
      J.part(prev, 'FAN-EVAP-10W', 1, J.van(E.lee), pv);
      J.complete(prev, pv, 'Evaporator fan motor failure');
      J.close(prev, true);
      J.job({ site_id: S.willows, kind: 'recall', priority: 'P2', title: 'Cold room alarm again — ice build-up on door frame', description: `Kitchen report alarm again and ice around door frame. Previous repair ${prev.job_no}. Possible door heater failure.`, created: dt(prevDay, '15:05'), assets: [J.asset('willows', 'CR-KIT')], reported_via: 'phone', reported_by: 'Kitchen Manager', parent_job_id: prev.id, skills: ['refrigeration'] });
    }

    // J. Kingsway heat pump — awaiting access
    {
      const job = J.job({ site_id: S.kingsway, kind: 'reactive', priority: 'P3', title: 'No hot water to welfare facilities (heat pump error)', description: 'Ecodan controller showing L6 error. Welfare block no hot water — temporary electric heaters in use.', created: dt(workingDayBefore(base, 3), '13:00'), assets: [J.asset('kingsway', 'HP-01')], reported_by: 'Stuart Byrne', reported_via: 'phone' });
      update('jobs', job.id, { status: 'on_hold', hold_reason: 'awaiting_access' });
      J.note(job, 'Site closed for stocktake until Thursday — Stuart will call to confirm access.', 'tom');
    }

    // K. Completed yesterday — awaiting office review / invoicing
    {
      const job = J.job({ site_id: S.knowsley, kind: 'reactive', priority: 'P3', title: 'Gatehouse AC not cooling', description: 'Security gatehouse split unit blowing warm.', created: dt(workingDayBefore(base, 2), '09:10'), assets: [J.asset('knowsley', 'SPL-SEC')], reported_by: 'Joanne Kerr', reported_via: 'phone', customer_ref: '4500-22790' });
      const v = J.visit(job, E.jason, dt(prevDay, '13:00'), 2, { outcome: 'fixed', summary: 'Outdoor fan not running — run capacitor failed (bulged). Replaced 35µF capacitor, checked fan motor windings OK, unit cooling, 12°C off-coil.' });
      J.part(job, 'CAP-RUN-35', 1, J.van(E.jason), v);
      J.complete(job, v, 'Failed outdoor fan run capacitor');
    }
    {
      const job = J.job({ site_id: S['knutsford-dental'], kind: 'reactive', priority: 'P3', title: 'Decontamination room AC leaking water', description: 'Water dripping from indoor unit onto worktop.', created: dt(workingDayBefore(base, 3), '08:50'), assets: [J.asset('knutsford-dental', 'SPL-DECON')], reported_by: 'Dr. Emma Lawson', reported_via: 'phone' });
      const v = J.visit(job, E.sam, dt(prevDay, '17:45'), 1.25, { outcome: 'fixed', summary: 'Condensate drain blocked with biofilm at trap. Cleared and flushed drain, treated tray with biocide tablets, tested with 2L water — draining freely.' });
      J.part(job, 'CHEM-BIO-TAB', 1, J.van(E.sam), v);
      J.complete(job, v, 'Blocked condensate drain');
      update('jobs', job.id, { ooh: 1 });
    }

    // L. Installation job — Deepdale Unit 7 VRF condenser replacement (Kestrel), day 2 of 3 today
    const deepdaleQuote = J.quote({ customer: 'kestrel', site: 'deepdale', kind: 'replacement', title: 'Unit 7 VRF condenser replacement', status: 'accepted', createdDaysAgo: 34, decidedDaysAgo: 20, prepared: 'gareth', customer_po: 'WO-57120', scope: 'Replace failed Toshiba SMMS-u 18kW VRF outdoor unit serving Unit 7 with new Toshiba SMMS-e equivalent. Recover existing R410A charge, crane lift (Sunday), flush and pressure test existing pipework, re-use indoor units, commission and hand over with F-Gas records.', lines: [
      ['equipment', null, 'Toshiba SMMS-e MMY-MAP1806FT8P-E outdoor unit', 1, 7450, 9685],
      ['labour', null, 'Installation engineers (2 × 3 days)', 48, 28, 68],
      ['access', null, 'Crane hire & lift plan (Sunday lift)', 1, 1150, 1495],
      ['materials', 'REF-R410A-10', 'R410A refrigerant top-up', 1, 118, 165],
      ['materials', 'REF-N2-OF', 'OFN pressure test', 2, 32, 55],
      ['other', null, 'Refrigerant recovery & disposal, waste removal', 1, 180, 260],
      ['labour', null, 'Commissioning & handover documentation', 4, 32, 68],
    ] });
    {
      const job = J.job({ site_id: S.deepdale, kind: 'installation', priority: 'P3', title: 'Unit 7 VRF condenser replacement', description: 'From quote — replace VRF-U7 outdoor unit. Crane lift completed Sunday.', created: addDays(now, -19), assets: [J.asset('deepdale', 'VRF-U7')], reported_via: 'quote', quote_id: deepdaleQuote, customer_ref: 'WO-57120', charge_type: 'quoted', est_hours: 24, skills: ['vrf', 'commissioning'] });
      update('quotes', deepdaleQuote, { converted_job_id: job.id });
      for (const eng of [E.mike, E.ryan]) {
        const v1 = J.visit(job, eng, dt(prevDay, '07:30'), 8.5, { outcome: 'further_visit', summary: eng === E.mike ? 'Old unit recovered & removed. New unit positioned on anti-vibration mounts. Pipework flushed.' : 'Assisted with recovery and positioning. Power supply isolated & re-terminated.' });
        J.visitDone(v1);
        J.liveVisit(job, eng, dt(base, '07:30'), 8.5, { outcome: 'further_visit', summary: 'Brazing complete, OFN pressure test at 38 bar holding. Evacuation started.', keepOpen: true });
        J.visit(job, eng, dt(nextDay, '07:30'), 8.5, { scheduledOnly: true, instructions: 'Charge, commission and handover. Kestrel portal upload.' });
      }
      update('jobs', job.id, { status: 'in_progress', attended_at: dt(prevDay, '07:35').toISOString() });
    }

    // M. Holden Mill cellar cooler replacement — accepted, converted, scheduled next week
    {
      const qid = J.quote({ customer: 'ribble', site: 'holden-mill', kind: 'replacement', title: 'Taproom cellar cooler replacement (R404A → R290)', status: 'accepted', createdDaysAgo: 18, decidedDaysAgo: 6, prepared: 'gareth', customer_po: 'RVB-0419', scope: 'Remove existing 1.8kW R404A cellar cooler (2014) and replace with new low-GWP R290 through-wall cellar cooler. Recover and dispose of R404A. Commission, set to 11°C and provide F-Gas decommissioning record.', lines: [
        ['equipment', null, 'IMI R290 cellar cooler 2.2kW through-wall', 1, 1680, 2350],
        ['labour', null, 'Engineers (2 × 1 day)', 16, 28, 68],
        ['materials', 'CU-38-15M', 'Copper pipe & fittings', 1, 58, 92],
        ['materials', 'INS-13-38', 'Insulation', 6, 3.1, 7.5],
        ['other', null, 'R404A recovery & disposal', 1, 95, 145],
      ] });
      const job = J.job({ site_id: S['holden-mill'], kind: 'installation', priority: 'P3', title: 'Taproom cellar cooler replacement (R404A → R290)', description: 'From accepted quote. Taproom closed Mon–Wed — install on Tuesday.', created: addDays(now, -5), assets: [J.asset('holden-mill', 'CEL-01')], reported_via: 'quote', quote_id: qid, customer_ref: 'RVB-0419', charge_type: 'quoted', est_hours: 16, skills: ['refrigeration'] });
      update('quotes', qid, { converted_job_id: job.id });
      const installDay = workingDayAfter(base, 5);
      J.visit(job, E.mike, dt(installDay, '07:30'), 8.5, { scheduledOnly: true });
      J.visit(job, E.ryan, dt(installDay, '07:30'), 8.5, { scheduledOnly: true });
      J.po(null, job, addDays(now, -4), 'ordered', [{ description: 'IMI R290 cellar cooler 2.2kW through-wall unit', qty: 1, unit_cost: 1680 }], 'airsource', ymd(workingDayAfter(base, 3)));
    }

    // N. Today's & upcoming PPM — generate jobs for plans due in the next 3 weeks, then book most of them
    const until = ymd(addDays(now, 21));
    const duePlans = q.all<Row>('SELECT p.* FROM ppm_plans p WHERE p.next_due_on <= ? ORDER BY p.next_due_on', until).map((p) => ({ ...p, site_name: '' }));
    const booking: Record<string, [string, string, number]> = {
      // plan name@site → engineer key, day offset, start
      'Quarterly VRF & AC service@harlow': ['dave', '08:00', 0],
      'Quarterly refrigeration & AC service@nff-bury': ['dave', '13:00', 0],
      '6-monthly AC & MVHR service@quayview': ['sam', '12:00', 0],
      'Annual boiler & water heater service@oakfield': ['craig', '08:00', 0],
      'Annual boiler service@meadowbank': ['craig', '13:30', 0],
      'Quarterly cold room service@willows': ['lee', '13:00', 0],
      'Quarterly chiller & AHU service@deansgate-hotel': ['chloe', '08:30', 0],
      '6-monthly AC & kitchen extract service@hollins': ['chloe', '14:00', 0],
      '6-monthly refrigeration service@holden-mill': ['imran', '09:00', 0],
      '6-monthly AC service@whitebirk': ['jason', '09:00', 1],
      '6-monthly VRF, AHU & AC service@staidans-high': ['sam', '08:00', 3],
      'Quarterly cold room service@deansgate-hotel': ['lee', '15:00', 4],
      'Quarterly refrigeration & AC service@nff-prestwich': ['lee', '07:00', 6],
      '6-monthly AC & heat pump service@kingsway': ['jason', '09:00', 7],
    };
    for (const p of duePlans) {
      const siteKey = Object.entries(ids.sites).find(([, v]) => v === p.site_id)![0];
      const assetIds = q.all<{ asset_id: number }>('SELECT asset_id FROM ppm_plan_assets WHERE plan_id = ?', p.id).map((a) => a.asset_id);
      const job = J.job({ site_id: p.site_id, kind: 'ppm', priority: 'P4', title: p.name, description: `Planned maintenance — ${p.frequency_months}-monthly visit.${p.scheduling_notes ? `\nScheduling: ${p.scheduling_notes}` : ''}`, created: addDays(now, -between(7, 14)), assets: assetIds, ppm_plan_id: p.id, due_on: p.next_due_on, target_start_on: ymd(addDays(parseYmd(p.next_due_on), -14)), est_hours: p.est_hours, reported_via: 'ppm_schedule', skills: JSON.parse(p.required_skills) });
      update('ppm_plans', p.id, { next_due_on: addMonths(p.next_due_on, p.frequency_months) });
      const b = booking[`${p.name}@${siteKey}`];
      if (!b) continue;
      const [engKey, time, offset] = b;
      const day = offset === 0 ? base : workingDayAfter(base, offset);
      const hours = Math.min(p.est_hours, 4);
      if (offset === 0) J.liveVisit(job, E[engKey], dt(day, time), hours, { outcome: 'ppm_complete', summary: ppmSummary(p.name), checklist: p.checklist_template_id });
      else J.visit(job, E[engKey], dt(day, time), hours, { scheduledOnly: true });
    }

    // O. Misc upcoming reactive/remedial visits so the board looks like a normal week
    {
      const job = J.job({ site_id: S['staidans-high'], kind: 'remedial', priority: 'P3', title: 'Boiler BLR-01 — replace burner gasket & flame probe (from PPM)', description: 'Remedial works identified at last service. Trust PO 7781.', created: addDays(now, -9), assets: [J.asset('staidans-high', 'BLR-01')], reported_via: 'engineer', customer_ref: 'PO 7781', charge_type: 'chargeable', skills: ['heating', 'gas'] });
      J.visit(job, E.paul, dt(nextDay, '09:00'), 3, { scheduledOnly: true, instructions: 'Rigby Gas subcontract — bring combustion analyser printout for records.' });
    }
    {
      const job = J.job({ site_id: S['nff-radcliffe'], kind: 'warranty', priority: 'P3', title: 'CO2 condensing unit — intermittent high pressure alarm (warranty)', description: 'Unit under manufacturer warranty. Emerson tech support case #EM-44102.', created: dt(prevDay, '11:00'), assets: [J.asset('nff-radcliffe', 'CU-01')], reported_via: 'email', reported_by: 'Sarah Whitehead' });
      J.visit(job, E.dave, dt(workingDayAfter(base, 2), '08:00'), 3, { scheduledOnly: true, instructions: 'Download controller alarm log for Emerson warranty claim before any work.' });
    }

    // ─── Quotes (pipeline) ─────────────────────────────────────────────────
    J.quote({ customer: 'salfordhub', site: 'chapel-mill', kind: 'installation', title: 'VRF heat recovery system — Chapel Street Mill (floors 1–4)', status: 'sent', createdDaysAgo: 16, sentDaysAgo: 12, followUpDays: -1, probability: 50, prepared: 'gareth', scope: 'Design, supply, install and commission a Mitsubishi Electric City Multi R2 heat recovery VRF system serving floors 1–4 (38 indoor units: ceiling cassettes to co-working areas, ducted units to meeting rooms), with centralised AE-200 controls, condensate pumps, and ventilation interfacing. Includes survey, design drawings, pressure testing, commissioning and O&M manuals.', lines: [
      ['equipment', null, 'City Multi PURY-EP500YNW-A R2 outdoor units', 2, 11800, 15340],
      ['equipment', null, 'BC controllers (main + sub)', 4, 1450, 1885],
      ['equipment', null, 'Indoor units — 4-way cassettes & ducted (38)', 38, 640, 832],
      ['equipment', null, 'AE-200 central controller + 38 wired remotes', 1, 3200, 4160],
      ['materials', null, 'Refrigerant pipework, insulation, supports & condensate', 1, 9800, 12740],
      ['labour', null, 'Installation labour (2 engineers × 32 days)', 512, 28, 68],
      ['access', null, 'Scissor lift & tower hire (6 weeks)', 1, 2400, 3120],
      ['labour', null, 'Commissioning, controls set-up & handover', 40, 32, 68],
    ] });
    J.quote({ customer: 'mersey', site: 'knowsley', kind: 'maintenance_contract', title: 'Knowsley DC — planned maintenance agreement (renewal proposal)', status: 'sent', createdDaysAgo: 24, sentDaysAgo: 21, followUpDays: -3, probability: 60, prepared: 'helen', scope: 'Annual PPM: VRF system 2× per year, gatehouse split 1× per year, cold room 4× per year including F-Gas leak checks and records. Reactive attendance within 8 working hours (P1) at contract rates; parts chargeable.', lines: [
      ['labour', null, 'VRF service visits (2 per year × 5h)', 10, 28, 68],
      ['labour', null, 'Cold room service visits (4 per year × 2.5h)', 10, 28, 68],
      ['labour', null, 'Gatehouse split service (1 per year)', 1.5, 28, 68],
      ['materials', null, 'Consumables, filters & cleaning chemicals', 1, 180, 260],
      ['other', null, 'F-Gas compliance records & annual report', 1, 0, 350],
      ['other', null, 'Travel allowance (Merseyside)', 17, 0, 32],
    ] });
    J.quote({ customer: 'staidans', site: 'staidans-high', kind: 'replacement', title: 'Main plant room boiler replacement (Purewell VariHeat 180)', status: 'sent', createdDaysAgo: 30, sentDaysAgo: 28, followUpDays: 4, probability: 40, prepared: 'gareth', scope: 'Replace existing 2011 Hamworthy Purewell VariHeat 180kW boiler (poor condition, repeated lockouts) with 2 × Hamworthy Wessex ModuMax mk3 cascade, new low-loss header, pumps, controls and flue. Works during February half-term. Commissioning by Rigby Gas Services.', lines: [
      ['equipment', null, 'Hamworthy Wessex ModuMax mk3 116/97 (×2) with cascade kit', 2, 7400, 9620],
      ['equipment', null, 'Low loss header, pumps & pressurisation unit', 1, 3900, 5070],
      ['materials', null, 'Flue system, pipework, valves & insulation', 1, 4200, 5460],
      ['subcontract', null, 'Commercial gas works & commissioning (Rigby Gas)', 1, 3600, 4680],
      ['labour', null, 'Mechanical installation (2 engineers × 5 days)', 80, 28, 68],
      ['other', null, 'Strip-out, disposal & asbestos-free certificate check', 1, 850, 1150],
    ] });
    J.quote({ customer: 'brightwater', site: 'oakfield', kind: 'replacement', title: 'East wing MVHR unit replacement', status: 'draft', createdDaysAgo: 3, prepared: 'gareth', scope: 'Replace failing Vent-Axia Sentinel Kinetic Advance MVHR serving east wing corridors with new unit of equivalent duty. Loft access — work in two phases to maintain ventilation.', lines: [
      ['equipment', null, 'Vent-Axia Sentinel Kinetic Advance SX replacement unit', 1, 1340, 1740],
      ['labour', null, 'Engineers (2 × 1 day)', 16, 28, 68],
      ['materials', 'FIL-G4-592', 'Filters & fittings', 2, 5.2, 12.5],
    ] });
    J.quote({ customer: 'deansgate', site: 'deansgate-hotel', kind: 'remedial', title: 'Freezer room compressor & controls upgrade', status: 'declined', createdDaysAgo: 75, sentDaysAgo: 72, decidedDaysAgo: 41, decline: 'Budget — deferred to next financial year (April).', prepared: 'gareth', lines: [
      ['equipment', 'COMP-ZB26', 'Copeland ZB26KCE scroll compressor', 1, 845, 1240],
      ['equipment', 'CTRL-XR06', 'Dixell XR06CX controller', 1, 46, 98],
      ['labour', null, 'Engineer (1 day)', 8, 28, 68],
      ['materials', 'REF-R448A-10', 'Refrigerant', 1, 265, 360],
    ] });
    J.quote({ customer: 'cheshiredental', site: 'knutsford-dental', kind: 'maintenance_contract', title: 'Annual AC servicing agreement (3 units)', status: 'sent', createdDaysAgo: 6, sentDaysAgo: 5, followUpDays: 2, probability: 70, prepared: 'helen', lines: [
      ['labour', null, 'Annual service visit — 3 splits (out of surgery hours)', 3, 28, 102],
      ['materials', 'CHEM-BIO-TAB', 'Consumables', 1, 11, 24],
    ] });
    J.quote({ customer: 'nff', site: 'nff-radcliffe', kind: 'installation', title: 'Additional 2.5m multideck — Radcliffe', status: 'draft', createdDaysAgo: 1, prepared: 'gareth', lines: [['equipment', null, 'Carrier Multideck 2.5m (integral to CO2 pack)', 1, 4200, 5460]] });
    J.quote({ customer: 'pennine', site: 'quayview', kind: 'other', title: 'MVHR F7 filter upgrade', status: 'declined', createdDaysAgo: 110, sentDaysAgo: 108, decidedDaysAgo: 80, decline: 'Tenant not willing to fund.', prepared: 'helen', lines: [['materials', 'FIL-F7-BAG', 'F7 filters', 4, 18.4, 38], ['labour', null, 'Engineer', 2, 28, 68]] });
    for (let i = 0; i < 6; i++) {
      const [cust, site, title, value] = pick([
        ['pennine', 'harlow', 'Replace 3rd floor cassette condensate pumps', 640],
        ['brightwater', 'meadowbank', 'Replace boiler pressurisation unit', 1880],
        ['nff', 'nff-bury', 'Cold room door strip curtain & heater', 520],
        ['deansgate', 'deansgate-hotel', 'AHU-02 fan bearing replacement', 1150],
        ['calderbrook', 'calderbrook-works', 'Replace office split (R410A 2013)', 2450],
        ['kestrel', 'deepdale', 'Mall AC unit condensate pump replacement', 410],
      ] as const);
      const accepted = rand() < 0.65;
      J.quote({ customer: cust, site, kind: 'remedial', title, status: accepted ? 'accepted' : 'declined', createdDaysAgo: between(30, 85), sentDaysAgo: between(25, 29), decidedDaysAgo: between(5, 24), decline: accepted ? undefined : 'Customer chose to defer', prepared: pick(['gareth', 'helen']), lines: [['labour', null, 'Engineer labour', Math.round(value / 180), 28, 68], ['materials', null, 'Parts & materials', 1, Math.round(value * 0.35), Math.round(value * 0.5)]] });
    }

    // ─── Stock POs ─────────────────────────────────────────────────────────
    J.po(null, null, addDays(now, -2), 'part_received', [{ part: 'FIL-G4-592', qty: 60 }, { part: 'FIL-F7-BAG', qty: 24 }, { part: 'BELT-SPZ-1000', qty: 10 }], 'filterflow', ymd(nextDay), [60, 24, 0]);
    J.po(null, null, addDays(now, -1), 'draft', [{ part: 'SW-LP-AUTO', qty: 6 }, { part: 'REF-R404A-10', qty: 2 }], 'nwrs');

    // ─── Service desk inbox ────────────────────────────────────────────────
    const enquiry = (minsAgo: number, e: Row) => insert('enquiries', { received_at: new Date(now.getTime() - minsAgo * 60_000).toISOString(), status: 'new', ...e });
    enquiry(22, { channel: 'email', from_name: 'Angela Firth', from_email: 'angela.firth@brightwatercare.example', subject: 'URGENT - no heating east wing', customer_id: ids.customers.brightwater, site_id: S.oakfield, body: "Hi,\n\nThe radiators in the east wing at Oakfield Lodge have gone stone cold since about lunchtime and the boiler house panel is showing a red light on one of the boilers. We have 14 residents in that wing, several are frail and we've had to move some into the lounge with blankets.\n\nPlease can someone come out as soon as possible. I'm on site until 8pm – 01204 555 710.\n\nThanks\nAngela Firth\nHome Manager, Oakfield Lodge" });
    enquiry(48, { channel: 'voicemail', from_name: 'Dean Mullins', from_phone: '07700 900912', subject: 'Voicemail — Vantage Gyms', customer_id: ids.customers.vantage, body: "Voicemail transcript: Hi it's Dean from Vantage Gyms. The air con on the main gym floor at Stockport isn't cooling at all today, it's roasting in there and members are complaining. Can you get someone out today or tomorrow morning? Call me back on 07700 900912. Cheers." });
    enquiry(95, { channel: 'email', from_name: 'Kestrel FM Helpdesk', from_email: 'helpdesk@kestrelfm.example', subject: 'Work Order WO-58931 — Deepdale Retail Park — Mall AC noisy', customer_id: ids.customers.kestrel, body: 'WORK ORDER WO-58931\nPriority: Routine (P3) — attend within 3 working days\nSite: Deepdale Retail Park, Blackpool Road, Preston PR1 6QY\nLocation: Mall walkway ducted AC unit\nDescription: Centre management report grinding noise from mall AC unit above walkway between Units 5 and 6. Unit still running.\nNTE: £350.00 + VAT. Seek authorisation above NTE.\nPlease upload job sheet to the Kestrel portal on completion.\n\nKestrel FM Helpdesk' });
    enquiry(160, { channel: 'web', from_name: 'Jonathan Pryce', from_email: 'jon@prycearchitects.example', from_phone: '01204 555 912', subject: 'Website enquiry: Installation or project enquiry', body: 'We are moving into a new first-floor office at 45 Bradshawgate, Bolton BL1 1QD in November (approx 280 m², 6 private offices + open studio). The space has no cooling at present. Could you provide a quotation for air conditioning — ideally heating as well? Happy to arrange a site visit any weekday.' });
    enquiry(240, { channel: 'email', from_name: 'Sarah Whitehead', from_email: 'sarah.whitehead@northernfresh.example', subject: 'Bury store — second cold room', customer_id: ids.customers.nff, body: "Hi Helen / team,\n\nWe're extending the back stores at Bury Market Street and want a second chiller cold room, roughly 2.4m × 2.4m, next to the existing one. Could you come and survey and give us a price? Ideally installed before the Christmas stock build (mid-November).\n\nThanks, Sarah" });
    enquiry(300, { channel: 'email', from_name: 'Janet Crompton', from_email: 'j.crompton@staidanshigh.example', subject: 'PPM visit — can we move to half term?', customer_id: ids.customers.staidans, site_id: S['staidans-high'], body: "Hello,\n\nI see your engineer is booked for the 6-monthly service next week. We have mock exams in the sports hall that week so the AHU can't be shut down. Could we move the visit to October half term (w/c 26th)?\n\nRegards,\nJanet Crompton, Facilities Manager" });
    enquiry(1500, { channel: 'email', from_name: 'Northwest Refrigeration Supplies', from_email: 'noreply@nwrefsupplies.example', subject: 'Your order has been dispatched', body: 'Your order has been dispatched and will be delivered tomorrow before 10:00. Reference NWRS-778123.' });
    const actioned = q.get<Row>(`SELECT id, site_id, customer_id FROM jobs WHERE title LIKE 'Water dripping from reception cassette'`)!;
    insert('enquiries', { channel: 'email', from_name: 'Lucy Grant', from_email: 'lucy.grant@quayviewtenant.example', subject: 'Leak from AC in reception', body: 'Hi, water is dripping from the air con in reception onto the desk. Can someone take a look? Lucy', received_at: dt(prevDay, '14:12').toISOString(), status: 'actioned', job_id: actioned.id, customer_id: actioned.customer_id, site_id: actioned.site_id, handled_by: ids.users.tom, handled_at: dt(prevDay, '14:20').toISOString() });

    // ─── CRM activities ────────────────────────────────────────────────────
    const act = (e: Row) => insert('activities', e);
    act({ customer_id: ids.customers.pennine, kind: 'meeting', subject: 'Contract review with Karen Oldfield', body: 'Renewal due in ~2 months. Happy with response times; wants quarterly reporting on reactive spend per building and R22 replacement plan for Harlow House.', user_id: ids.users.helen, created_at: addDays(now, -9).toISOString() });
    act({ customer_id: ids.customers.pennine, kind: 'task', subject: 'Prepare renewal pack for Pennine portfolio contract', due_on: ymd(addDays(now, 10)), user_id: ids.users.helen, created_at: addDays(now, -9).toISOString() });
    act({ customer_id: ids.customers.salfordhub, kind: 'call', direction: 'outbound', subject: 'Follow-up on VRF proposal', body: 'Aisha reviewing with M&E consultant; decision expected after board meeting. Asked about phasing floors 1–2 first.', user_id: ids.users.gareth, created_at: addDays(now, -4).toISOString() });
    act({ customer_id: ids.customers.staidans, kind: 'task', subject: "Chase Trust governors' decision on boiler replacement", due_on: ymd(addDays(now, 4)), user_id: ids.users.gareth, created_at: addDays(now, -20).toISOString() });
    act({ customer_id: ids.customers.mersey, kind: 'email', direction: 'outbound', subject: 'PPM renewal proposal sent', user_id: ids.users.helen, created_at: addDays(now, -21).toISOString() });
    act({ customer_id: ids.customers.vantage, kind: 'note', subject: 'Account on stop', body: 'Credit control: no chargeable work until overdue invoices cleared. Emergency safety attendance only with MD approval.', user_id: ids.users.martin, created_at: addDays(now, -14).toISOString() });
    act({ customer_id: ids.customers.mersey, kind: 'task', subject: 'Call Joanne re renewal proposal', due_on: ymd(addDays(now, -1)), user_id: ids.users.helen, created_at: addDays(now, -10).toISOString() });

    // Sequences for future numbering
    for (const [name, value] of Object.entries(seq)) q.run('INSERT INTO sequences (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', name, value);
  });

  console.log(`Seeded demo data (base day ${ymd(base)}${baseIsToday ? '' : ' — next working day'}). Sign in with any demo user, password "${DEMO_PASSWORD}".`);

}

const pending = new Map<number, any>();

function readingFor(key: string) {
  const r: Record<string, () => number> = {
    supply_temp: () => between(10, 14),
    return_temp: () => between(21, 25),
    suction: () => Math.round((7 + rand() * 3) * 10) / 10,
    discharge: () => Math.round((24 + rand() * 6) * 10) / 10,
    amps: () => Math.round((4 + rand() * 8) * 10) / 10,
    cabinet_temp: () => between(2, 5),
    dp: () => between(80, 180),
    airflow: () => Math.round((1.2 + rand() * 2) * 10) / 10,
    gas_pressure: () => Math.round((17 + rand() * 3) * 10) / 10,
    combustion: () => Math.round((0.0008 + rand() * 0.001) * 10000) / 10000,
  };
  return (r[key] ?? (() => between(1, 10)))();
}

type Fault = { title: string; description: string; priority: Priority; first: string; resolution: string; cause: string; part?: string; refrigerantKg?: number; nff?: boolean };

function faultFor(category: string): Fault {
  const ac: Fault[] = [
    { title: 'AC unit not cooling', description: 'Unit running but blowing warm air.', priority: 'P3', first: 'Low charge suspected, leak search required with nitrogen.', resolution: 'Flare leak on liquid line at indoor unit. Re-made flare, pressure tested with OFN, evacuated and recharged. Unit cooling, 11°C off-coil.', cause: 'Flare joint leak', part: 'LEAK-DET-SPRAY', refrigerantKg: 0.6 },
    { title: 'Water leaking from indoor unit', description: 'Water dripping onto floor/desk below unit.', priority: 'P3', first: 'Condensate pump failed — need replacement pump.', resolution: 'Condensate pump failed. Replaced with Aspen Mini Orange, cleaned tray, tested with water — pumping correctly.', cause: 'Condensate pump failure', part: 'PUMP-COND-MINI' },
    { title: 'AC showing error code / not starting', description: 'Remote showing error code, unit will not start.', priority: 'P3', first: 'Indoor PCB suspected — ordering replacement.', resolution: 'Indoor coil thermistor open circuit. Replaced thermistor, cleared fault, unit running normally.', cause: 'Failed thermistor', part: 'THERM-10K' },
    { title: 'Outdoor unit fan not running', description: 'Unit tripping after 10 minutes.', priority: 'P3', first: 'Fan motor capacitor failed.', resolution: 'Outdoor fan run capacitor failed. Replaced capacitor, checked motor windings and bearings OK, unit running.', cause: 'Failed run capacitor', part: 'CAP-RUN-35' },
    { title: 'AC unit noisy', description: 'Rattling noise from indoor unit.', priority: 'P4', first: '', resolution: 'Loose louvre motor bracket and debris in fan scroll. Cleaned and secured. No fault with unit operation.', cause: 'Debris in fan', nff: false },
    { title: 'Server/comms room AC failed — high temperature', description: 'Comms room temperature alarm, unit not running.', priority: 'P1', first: 'Compressor contactor failed.', resolution: 'Compressor contactor coil burnt out. Replaced contactor, unit restarted, room back to 21°C within 40 minutes.', cause: 'Failed contactor', part: 'CON-3P-25A' },
  ];
  const refrig: Fault[] = [
    { title: 'Cold room high temperature alarm', description: 'Cold room reading +9°C, alarm sounding. Stock moved.', priority: 'P1', first: 'Evaporator fan motor failed, ordering motor.', resolution: 'Evaporator fan motor seized. Replaced motor, defrosted coil, room pulling down to +3°C.', cause: 'Evaporator fan motor failure', part: 'FAN-EVAP-10W' },
    { title: 'Display case iced up / running warm', description: 'Multideck running warm, ice on evaporator.', priority: 'P2', first: '', resolution: 'Defrost not terminating — controller probe failed. Replaced controller, manual defrost, case at 3°C.', cause: 'Controller failure', part: 'CTRL-XR06' },
    { title: 'Condensing unit tripping on high pressure', description: 'Unit tripping, manual resets needed.', priority: 'P2', first: '', resolution: 'Condenser coil heavily blocked with debris. Cleaned coil, HP switch tested and reset, head pressure normal.', cause: 'Blocked condenser', part: 'CHEM-COIL-5L' },
    { title: 'Freezer not holding temperature', description: 'Freezer at -11°C.', priority: 'P1', first: 'Low pressure switch faulty — replacement ordered.', resolution: 'Low pressure switch faulty causing short cycling. Replaced switch, set cut-in/out, freezer at -19°C.', cause: 'Faulty LP switch', part: 'SW-LP-AUTO' },
  ];
  const heating: Fault[] = [
    { title: 'Boiler locked out — no heating', description: 'Boiler showing lockout, no heating to building.', priority: 'P1', first: 'Gas valve suspected — replacement ordered.', resolution: 'Ignition electrode worn and incorrectly gapped. Replaced electrode set, combustion checked (CO/CO2 0.0012), boiler firing.', cause: 'Worn ignition electrode', part: 'IGN-ELEC-HAM' },
    { title: 'Heating not reaching temperature', description: 'Radiators lukewarm in part of building.', priority: 'P2', first: 'Circulating pump seized, replacement pump ordered.', resolution: 'Circulating pump seized. Replaced Grundfos UPS pump, bled system, flow & return temps normal.', cause: 'Pump failure', part: 'PUMP-GRUND-UPS' },
    { title: 'Boiler intermittent lockout', description: 'Locking out once or twice a day.', priority: 'P3', first: '', resolution: 'Condensate trap partially blocked causing flame failure. Cleaned trap and siphon, replaced burner gasket, tested — no further lockouts.', cause: 'Blocked condensate trap', part: 'FLUE-GASKET' },
  ];
  const vent: Fault[] = [
    { title: 'AHU tripped — no ventilation', description: 'AHU not running, fault on panel.', priority: 'P2', first: 'Motor bearing noisy — bearings ordered.', resolution: 'Drive belt snapped. Replaced belt, aligned pulleys and tensioned, AHU running, airflow restored.', cause: 'Broken drive belt', part: 'BELT-SPA-1250' },
    { title: 'Kitchen extract fan not running', description: 'Canopy extract not working, kitchen too hot.', priority: 'P1', first: '', resolution: 'Fan motor overload tripped due to failed bearing. Replaced bearings, reset overload, fan running with normal current.', cause: 'Bearing failure', part: 'BRG-6204' },
    { title: 'Poor airflow / stuffy rooms', description: 'Complaints of stuffy offices.', priority: 'P3', first: '', resolution: 'Filters fully blocked. Replaced G4 panel filters, airflow restored. Recommend increasing filter change frequency.', cause: 'Blocked filters', part: 'FIL-G4-592' },
  ];
  const chiller: Fault[] = [{ title: 'Chiller alarm — low water flow', description: 'Chiller shut down on flow alarm.', priority: 'P2', first: '', resolution: 'Strainer blocked. Isolated, cleaned strainer, flow switch reset and tested, chiller restarted.', cause: 'Blocked strainer' }];
  const hp: Fault[] = [{ title: 'Heat pump error — no hot water', description: 'Controller showing error, no hot water.', priority: 'P3', first: '', resolution: 'Flow rate fault — air in system. Bled system, cleaned magnetic filter, topped up pressure to 1.5 bar, cleared error.', cause: 'Air in system' }];
  if (['Split AC', 'Multi-split AC', 'Cassette unit', 'Ducted unit', 'Fan coil unit', 'VRF outdoor unit', 'VRF indoor unit'].includes(category)) return pick(ac);
  if (['Cold room', 'Condensing unit', 'Refrigerated display'].includes(category)) return pick(refrig);
  if (['Boiler', 'Water heater', 'Other'].includes(category)) return pick(heating);
  if (['Air handling unit', 'Extract fan', 'Kitchen extract canopy', 'Heat recovery unit (MVHR)'].includes(category)) return pick(vent);
  if (category === 'Chiller') return pick(chiller);
  if (category === 'Air source heat pump') return pick(hp);
  return pick(ac);
}

// CLI: npm run seed — wipe and reseed
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.env.FROSTLINE_DB ?? path.join(DATA_DIR, 'frostline.db');
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  setDb(openDb(file));
  seed();
  db().close();
}
