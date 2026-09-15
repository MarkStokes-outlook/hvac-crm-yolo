-- FrostLine Operations — SQLite schema
-- Datetimes are stored as ISO-8601 UTC strings; dates (no time) as YYYY-MM-DD.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequences (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- ─── People ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','coordinator','engineer','sales','stores')),
  job_title     TEXT,
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS engineers (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id),
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'employee' CHECK (kind IN ('employee','subcontractor')),
  company       TEXT,                 -- for subcontractors
  grade         TEXT NOT NULL DEFAULT 'engineer' CHECK (grade IN ('apprentice','improver','engineer','senior','lead')),
  team          TEXT NOT NULL DEFAULT 'service' CHECK (team IN ('service','installation')),
  phone         TEXT,
  email         TEXT,
  home_postcode TEXT,
  home_lat      REAL,
  home_lng      REAL,
  van_reg       TEXT,
  skills        TEXT NOT NULL DEFAULT '[]',   -- JSON array of skill codes
  day_start     TEXT NOT NULL DEFAULT '08:00',
  day_end       TEXT NOT NULL DEFAULT '16:30',
  colour        TEXT NOT NULL DEFAULT '#3a8fb7',
  hourly_cost   REAL NOT NULL DEFAULT 28,
  active        INTEGER NOT NULL DEFAULT 1,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS engineer_qualifications (
  id          INTEGER PRIMARY KEY,
  engineer_id INTEGER NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,        -- e.g. FGAS_CAT1, GAS_SAFE_COMM, IPAF
  name        TEXT NOT NULL,
  reference   TEXT,
  issued_on   TEXT,
  expires_on  TEXT
);

CREATE TABLE IF NOT EXISTS absences (
  id          INTEGER PRIMARY KEY,
  engineer_id INTEGER NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('holiday','sick','training','other')),
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS on_call (
  id          INTEGER PRIMARY KEY,
  engineer_id INTEGER NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  starts_on   TEXT NOT NULL,
  ends_on     TEXT NOT NULL
);

-- ─── CRM ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                 INTEGER PRIMARY KEY,
  account_no         TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'end_client' CHECK (kind IN ('end_client','managing_agent','fm_provider','main_contractor','public_sector')),
  sector             TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('prospect','active','inactive')),
  on_stop            INTEGER NOT NULL DEFAULT 0,
  on_stop_reason     TEXT,
  phone              TEXT,
  email              TEXT,
  website            TEXT,
  billing_address    TEXT,
  billing_postcode   TEXT,
  invoice_email      TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  po_required        INTEGER NOT NULL DEFAULT 0,
  vat_number         TEXT,
  account_manager_id INTEGER REFERENCES users(id),
  source             TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id                 INTEGER PRIMARY KEY,
  customer_id        INTEGER NOT NULL REFERENCES customers(id),
  end_client_id      INTEGER REFERENCES customers(id), -- building occupier when customer is an agent / FM provider
  name               TEXT NOT NULL,
  site_code          TEXT,
  address            TEXT,
  town               TEXT,
  county             TEXT,
  postcode           TEXT,
  lat                REAL,
  lng                REAL,
  building_type      TEXT,
  opening_hours      TEXT,
  access_notes       TEXT,
  parking_notes      TEXT,
  hazards            TEXT,
  induction_required INTEGER NOT NULL DEFAULT 0,
  permit_to_work     INTEGER NOT NULL DEFAULT 0,
  dbs_required       INTEGER NOT NULL DEFAULT 0,
  ooh_access         TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id     INTEGER REFERENCES sites(id),
  name        TEXT NOT NULL,
  job_title   TEXT,
  email       TEXT,
  phone       TEXT,
  mobile      TEXT,
  roles       TEXT NOT NULL DEFAULT '[]', -- JSON: primary, site, accounts, decision_maker, out_of_hours
  is_primary  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  site_id     INTEGER REFERENCES sites(id),
  contact_id  INTEGER REFERENCES contacts(id),
  job_id      INTEGER REFERENCES jobs(id),
  quote_id    INTEGER REFERENCES quotes(id),
  kind        TEXT NOT NULL CHECK (kind IN ('call','email','meeting','note','task')),
  direction   TEXT CHECK (direction IN ('inbound','outbound')),
  subject     TEXT NOT NULL,
  body        TEXT,
  due_on      TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ─── Equipment ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id                   INTEGER PRIMARY KEY,
  site_id              INTEGER NOT NULL REFERENCES sites(id),
  parent_asset_id      INTEGER REFERENCES assets(id),
  tag                  TEXT NOT NULL,
  category             TEXT NOT NULL,
  description          TEXT,
  manufacturer         TEXT,
  model                TEXT,
  serial_number        TEXT,
  location             TEXT,
  install_date         TEXT,
  installed_by_us      INTEGER NOT NULL DEFAULT 0,
  warranty_expires     TEXT,
  refrigerant          TEXT,
  refrigerant_kg       REAL,
  leak_detection       INTEGER NOT NULL DEFAULT 0,
  capacity_kw          REAL,
  fuel                 TEXT,
  status               TEXT NOT NULL DEFAULT 'operational' CHECK (status IN ('operational','faulty','out_of_service','decommissioned')),
  condition            TEXT CHECK (condition IN ('good','fair','poor','end_of_life')),
  last_leak_check_on   TEXT,
  last_serviced_on     TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ─── Contracts & planned maintenance ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id               INTEGER PRIMARY KEY,
  ref              TEXT NOT NULL UNIQUE,
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  name             TEXT NOT NULL,
  level            TEXT NOT NULL CHECK (level IN ('ppm_only','ppm_reactive','comprehensive')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','expired','cancelled')),
  starts_on        TEXT NOT NULL,
  ends_on          TEXT NOT NULL,
  annual_value     REAL NOT NULL DEFAULT 0,
  billing_cycle    TEXT NOT NULL DEFAULT 'quarterly' CHECK (billing_cycle IN ('monthly','quarterly','annually')),
  ooh_cover        INTEGER NOT NULL DEFAULT 0,
  labour_included  INTEGER NOT NULL DEFAULT 0,  -- reactive labour covered
  parts_included   INTEGER NOT NULL DEFAULT 0,  -- parts covered (usually up to a limit)
  parts_limit      REAL,                        -- per-job parts cap when included
  auto_renew       INTEGER NOT NULL DEFAULT 0,
  notice_days      INTEGER NOT NULL DEFAULT 90,
  account_manager_id INTEGER REFERENCES users(id),
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS contract_sites (
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  site_id     INTEGER NOT NULL REFERENCES sites(id),
  PRIMARY KEY (contract_id, site_id)
);

-- Response/fix targets per priority for a contract. Uncontracted work uses settings.default_sla.
CREATE TABLE IF NOT EXISTS contract_sla (
  contract_id    INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  priority       TEXT NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
  response_hours REAL NOT NULL,
  fix_hours      REAL,
  basis          TEXT NOT NULL DEFAULT 'business' CHECK (basis IN ('business','24x7')),
  PRIMARY KEY (contract_id, priority)
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  items TEXT NOT NULL  -- JSON array of {key,label,kind:'check'|'reading'|'text',unit?}
);

CREATE TABLE IF NOT EXISTS ppm_plans (
  id                   INTEGER PRIMARY KEY,
  contract_id          INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  site_id              INTEGER NOT NULL REFERENCES sites(id),
  name                 TEXT NOT NULL,
  frequency_months     INTEGER NOT NULL,
  est_hours            REAL NOT NULL DEFAULT 2,
  engineers_required   INTEGER NOT NULL DEFAULT 1,
  required_skills      TEXT NOT NULL DEFAULT '[]',
  checklist_template_id INTEGER REFERENCES checklist_templates(id),
  next_due_on          TEXT NOT NULL,
  preferred_engineer_id INTEGER REFERENCES engineers(id),
  scheduling_notes     TEXT,
  active               INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ppm_plan_assets (
  plan_id  INTEGER NOT NULL REFERENCES ppm_plans(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  PRIMARY KEY (plan_id, asset_id)
);

-- ─── Service desk inbox ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enquiries (
  id           INTEGER PRIMARY KEY,
  channel      TEXT NOT NULL CHECK (channel IN ('email','phone','web','voicemail')),
  from_name    TEXT,
  from_email   TEXT,
  from_phone   TEXT,
  subject      TEXT,
  body         TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','actioned','dismissed')),
  customer_id  INTEGER REFERENCES customers(id),
  site_id      INTEGER REFERENCES sites(id),
  job_id       INTEGER REFERENCES jobs(id),
  quote_id     INTEGER REFERENCES quotes(id),
  triage       TEXT,       -- JSON result of AI/rule triage
  handled_by   INTEGER REFERENCES users(id),
  handled_at   TEXT
);

-- ─── Jobs & visits ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                 INTEGER PRIMARY KEY,
  job_no             TEXT NOT NULL UNIQUE,
  customer_id        INTEGER NOT NULL REFERENCES customers(id),
  site_id            INTEGER NOT NULL REFERENCES sites(id),
  contract_id        INTEGER REFERENCES contracts(id),
  kind               TEXT NOT NULL CHECK (kind IN ('reactive','ppm','remedial','quoted','installation','survey','warranty','recall')),
  priority           TEXT NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1','P2','P3','P4')),
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','scheduled','in_progress','on_hold','completed','closed','cancelled')),
  hold_reason        TEXT CHECK (hold_reason IN ('awaiting_parts','awaiting_quote_approval','awaiting_access','awaiting_customer','awaiting_subcontractor','other')),
  title              TEXT NOT NULL,
  description        TEXT,
  reported_by        TEXT,
  reported_contact_id INTEGER REFERENCES contacts(id),
  reported_via       TEXT CHECK (reported_via IN ('phone','email','web','engineer','ppm_schedule','quote','internal')),
  customer_ref       TEXT,      -- customer PO / work order number
  nte_limit          REAL,      -- not-to-exceed value authorised by customer
  charge_type        TEXT NOT NULL DEFAULT 'chargeable' CHECK (charge_type IN ('contract','chargeable','quoted','warranty','non_chargeable')),
  quote_id           INTEGER REFERENCES quotes(id),
  ppm_plan_id        INTEGER REFERENCES ppm_plans(id),
  parent_job_id      INTEGER REFERENCES jobs(id),
  required_skills    TEXT NOT NULL DEFAULT '[]',
  est_hours          REAL NOT NULL DEFAULT 2,
  ooh                INTEGER NOT NULL DEFAULT 0,
  target_start_on    TEXT,      -- PPM window / planned start
  due_on             TEXT,      -- PPM window end
  respond_by         TEXT,
  fix_by             TEXT,
  attended_at        TEXT,
  completed_at       TEXT,
  closed_at          TEXT,
  cause              TEXT,
  resolution         TEXT,
  invoice_status     TEXT NOT NULL DEFAULT 'not_ready' CHECK (invoice_status IN ('not_ready','ready','invoiced','not_chargeable')),
  invoice_ref        TEXT,
  invoice_value      REAL,
  logged_by          INTEGER REFERENCES users(id),
  owner_id           INTEGER REFERENCES users(id),   -- coordinator responsible
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS jobs_site ON jobs(site_id);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS job_assets (
  job_id   INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  PRIMARY KEY (job_id, asset_id)
);

CREATE TABLE IF NOT EXISTS visits (
  id                INTEGER PRIMARY KEY,
  job_id            INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  engineer_id       INTEGER NOT NULL REFERENCES engineers(id),
  starts_at         TEXT NOT NULL,
  ends_at           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','accepted','travelling','on_site','completed','incomplete','cancelled')),
  instructions      TEXT,
  travel_started_at TEXT,
  arrived_at        TEXT,
  departed_at       TEXT,
  outcome           TEXT CHECK (outcome IN ('fixed','temporary_fix','further_visit','parts_required','quote_required','no_access','no_fault_found','ppm_complete')),
  work_summary      TEXT,
  signed_by         TEXT,
  signature         TEXT,     -- data URL
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS visits_eng_time ON visits(engineer_id, starts_at);
CREATE INDEX IF NOT EXISTS visits_job ON visits(job_id);

CREATE TABLE IF NOT EXISTS visit_checklists (
  id          INTEGER PRIMARY KEY,
  visit_id    INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  asset_id    INTEGER REFERENCES assets(id),
  template_id INTEGER REFERENCES checklist_templates(id),
  responses   TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS job_notes (
  id         INTEGER PRIMARY KEY,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  visit_id   INTEGER REFERENCES visits(id),
  user_id    INTEGER REFERENCES users(id),
  kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','engineer','customer_update','system')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS job_parts (
  id          INTEGER PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  visit_id    INTEGER REFERENCES visits(id),
  part_id     INTEGER REFERENCES parts(id),
  description TEXT NOT NULL,
  qty         REAL NOT NULL,
  unit_cost   REAL NOT NULL DEFAULT 0,
  unit_price  REAL NOT NULL DEFAULT 0,
  location_id INTEGER REFERENCES stock_locations(id),
  added_by    INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- F-Gas refrigerant handling record
CREATE TABLE IF NOT EXISTS refrigerant_logs (
  id           INTEGER PRIMARY KEY,
  asset_id     INTEGER NOT NULL REFERENCES assets(id),
  job_id       INTEGER REFERENCES jobs(id),
  visit_id     INTEGER REFERENCES visits(id),
  engineer_id  INTEGER REFERENCES engineers(id),
  logged_on    TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('leak_check','added','recovered')),
  refrigerant  TEXT,
  qty_kg       REAL NOT NULL DEFAULT 0,
  leak_found   INTEGER NOT NULL DEFAULT 0,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS defects (
  id             INTEGER PRIMARY KEY,
  site_id        INTEGER NOT NULL REFERENCES sites(id),
  asset_id       INTEGER REFERENCES assets(id),
  job_id         INTEGER REFERENCES jobs(id),
  visit_id       INTEGER REFERENCES visits(id),
  severity       TEXT NOT NULL CHECK (severity IN ('advisory','recommended','urgent','unsafe')),
  description    TEXT NOT NULL,
  recommendation TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','quoted','approved','declined','resolved')),
  quote_id       INTEGER REFERENCES quotes(id),
  raised_by      INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  visit_id    INTEGER REFERENCES visits(id),
  filename    TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime        TEXT,
  size        INTEGER,
  caption     TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS attachments_entity ON attachments(entity_type, entity_id);

-- ─── Quotes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id              INTEGER PRIMARY KEY,
  quote_no        TEXT NOT NULL UNIQUE,
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  site_id         INTEGER REFERENCES sites(id),
  contact_id      INTEGER REFERENCES contacts(id),
  kind            TEXT NOT NULL DEFAULT 'repair' CHECK (kind IN ('repair','remedial','replacement','installation','maintenance_contract','other')),
  title           TEXT NOT NULL,
  scope           TEXT,
  exclusions      TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','expired','cancelled')),
  source_job_id   INTEGER REFERENCES jobs(id),
  prepared_by     INTEGER REFERENCES users(id),
  valid_until     TEXT,
  sent_at         TEXT,
  decided_at      TEXT,
  decline_reason  TEXT,
  customer_po     TEXT,
  follow_up_on    TEXT,
  probability     INTEGER,
  converted_job_id INTEGER REFERENCES jobs(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS quote_lines (
  id          INTEGER PRIMARY KEY,
  quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sort        INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL CHECK (kind IN ('labour','materials','equipment','subcontract','access','other')),
  part_id     INTEGER REFERENCES parts(id),
  description TEXT NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  unit_cost   REAL NOT NULL DEFAULT 0,
  unit_price  REAL NOT NULL DEFAULT 0
);

-- ─── Stock & purchasing ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  account_no  TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  categories  TEXT,
  lead_days   INTEGER NOT NULL DEFAULT 1,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id                    INTEGER PRIMARY KEY,
  sku                   TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  category              TEXT NOT NULL,
  unit                  TEXT NOT NULL DEFAULT 'each',
  unit_cost             REAL NOT NULL DEFAULT 0,
  sell_price            REAL NOT NULL DEFAULT 0,
  preferred_supplier_id INTEGER REFERENCES suppliers(id),
  supplier_code         TEXT,
  active                INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stock_locations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('depot','van')),
  engineer_id INTEGER REFERENCES engineers(id)
);

CREATE TABLE IF NOT EXISTS stock_levels (
  part_id     INTEGER NOT NULL REFERENCES parts(id),
  location_id INTEGER NOT NULL REFERENCES stock_locations(id),
  qty         REAL NOT NULL DEFAULT 0,
  min_qty     REAL NOT NULL DEFAULT 0,
  max_qty     REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (part_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id               INTEGER PRIMARY KEY,
  part_id          INTEGER NOT NULL REFERENCES parts(id),
  from_location_id INTEGER REFERENCES stock_locations(id),
  to_location_id   INTEGER REFERENCES stock_locations(id),
  qty              REAL NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('receipt','transfer','job_use','adjustment','return')),
  job_id           INTEGER REFERENCES jobs(id),
  po_id            INTEGER REFERENCES purchase_orders(id),
  user_id          INTEGER REFERENCES users(id),
  note             TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              INTEGER PRIMARY KEY,
  po_no           TEXT NOT NULL UNIQUE,
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id),
  job_id          INTEGER REFERENCES jobs(id),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','part_received','received','cancelled')),
  deliver_to      TEXT NOT NULL DEFAULT 'depot' CHECK (deliver_to IN ('depot','site','collect')),
  location_id     INTEGER REFERENCES stock_locations(id), -- where received stock lands
  required_by     TEXT,
  ordered_at      TEXT,
  supplier_ref    TEXT,
  notes           TEXT,
  raised_by       INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS po_lines (
  id           INTEGER PRIMARY KEY,
  po_id        INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  part_id      INTEGER REFERENCES parts(id),
  description  TEXT NOT NULL,
  qty          REAL NOT NULL,
  qty_received REAL NOT NULL DEFAULT 0,
  unit_cost    REAL NOT NULL DEFAULT 0
);

-- ─── Audit & AI ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  detail      TEXT,
  via_ai      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  title      TEXT,
  messages   TEXT NOT NULL DEFAULT '[]',  -- JSON Anthropic MessageParam[]
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
