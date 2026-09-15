# FrostLine Ops

Operations & CRM system for Frostline Mechanical Services — service desk, scheduling, engineers' mobile app,
equipment records, contracts & PPM, quotes, stock/purchasing, compliance — with an AI assistant that can act on the
system for you.

## Run it

Requires Node 22+.

```bash
cd app
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY to enable AI features (optional)
npm run dev                 # API on :3001, web on http://localhost:5173
```

The database (`app/data/frostline.db`, SQLite) is created and filled with demo data on first start.
`npm run seed` wipes it and regenerates demo data relative to today's date.

Production-style single process: `npm run build && npm start` → http://localhost:3001

Tests: `npm test` (service-layer, permissions, AI tool layer and HTTP). `npm run typecheck`.

## Demo accounts (password `frostline`)

| Who | Role | Try |
| --- | --- | --- |
| Rachel Dunn | Service coordinator | Dashboard, inbox, log a call, schedule |
| Susan Mercer | Operations director (manager) | Reports, invoicing, settings |
| Gareth Lloyd / Helen Price | Estimator / account manager | Quotes, contracts, customers |
| Kevin Walsh | Stores | Stock, purchase orders |
| Dave Whittaker, Lee Ashworth, Sam Okafor … | Engineers | Mobile app at `/m` (use a phone-sized window) |
| Martin Hale | Admin | Everything |

## What's in it

- **Service desk** — shared-mailbox style inbox (emails, voicemails, web forms) matched to customers/sites, triage
  (AI, or keyword rules without a key) and one-click job creation. "Log a call" screen with site lookup, contract cover,
  SLA preview, equipment picker, on-stop and PO checks.
- **Jobs** — reactive, PPM, remedial, quoted works, installation, survey, warranty, recalls. Multi-visit jobs, hold
  reasons (parts / quote approval / access…), notes & customer updates, parts from van or depot, defects,
  F-Gas refrigerant records, photos, checklists, customer sign-off, job valuation, audit history.
- **SLA engine** — per-contract response/fix targets by priority, 24/7 or working-hours clocks (UK bank holidays),
  standard terms for uncontracted work, "heat" indicators for at-risk/breached.
- **Scheduling** — day/week board per engineer with absences and on-call, drag-and-drop booking and rescheduling
  with clash detection. **Who can attend** ranks engineers by skills and tickets (F-Gas, Gas Safe, DBS), earliest
  realistic slot including travel from their previous job, SLA fit, familiarity with the site and workload.
- **Engineer mobile app** — today's jobs, directions/call site, travel → arrive → complete, site access and hazards,
  equipment and site history, PPM checklists with readings, van stock usage, refrigerant log, defects, photos, notes
  (AI tidy-up), outcome and signature.
- **Customers, sites, contacts, equipment** — managing agents / FM providers with end clients, site access and safety
  info, asset register with parent/child units, service history, F-Gas CO₂e and leak-check intervals.
- **Contracts & PPM** — cover levels (PPM only / PPM + reactive / comprehensive), OOH cover, parts limits, SLA table,
  covered sites, PPM plans that generate jobs when due, renewal tracking and contract performance.
- **Quotes** — draft → sent → accepted/declined → job. Line editor with cost/margin, AI drafting from engineer findings
  and defects using the parts catalogue and rate card, printable quotation (save as PDF), follow-ups and pipeline.
- **Stock & purchasing** — parts catalogue, depot and van stock with min/max, transfers, van top-up, low stock,
  purchase orders (job-linked POs release "awaiting parts" jobs when received).
- **Compliance** — F-Gas checks due/overdue, R22 plant, engineer tickets expiring, warranties, unsafe defects.
- **Invoicing hand-off** — completed chargeable work with labour/parts valuation and PO checks, CSV export for the
  accounts package, record invoice numbers. (Not an accounting system.)
- **Reports** — SLA compliance, first-time fix, recalls, PPM on time, quote win rate, engineer hours, problem sites.

## AI

- **Ask Frostline** (panel on every page, and on mobile): a tool-using agent (Claude, via the Anthropic SDK) that acts
  through the same service layer as the UI, with the signed-in user's permissions. It knows which record you're
  looking at. It can search, log jobs, work out who can attend and book them, move/cancel visits, draft/update quotes,
  check stock and raise POs, generate PPM jobs, read contracts, KPIs and compliance. Changes are listed with links and
  written to the audit log as "via assistant"; irreversible actions are confirmed first.
- **Embedded features**: inbox/call triage, quote drafting, engineer site briefings, tidy-up of engineer notes,
  customer update drafts (email/SMS).

Server code: `server/ai/agent.ts` (agent loop), `server/ai/tools.ts` (tools), `server/ai/features.ts`.

## Layout

```
app/
  server/        Express API (TypeScript, run with tsx)
    db/          SQLite schema + helpers
    services/    domain logic (jobs, scheduling, SLA, quotes, stock, contracts, …)
    ai/          assistant + AI features
    seed/        demo data
  src/           React + Tailwind UI (desktop pages, mobile/ engineer app)
  tests/         Vitest
```

## Assumptions made

- Working hours for SLA clocks Mon–Fri 08:00–17:30 excluding England bank holidays; standard (uncontracted) response
  P1 8h / P2 16h / P3 40h / P4 80h working hours — editable in Settings, contract terms per contract.
- Travel times are estimated from postcode coordinates (straight line × road factor), no external mapping service.
- Rates (labour £68/h, call-out £95, 30% materials markup, etc.) are placeholders — editable in Settings.
- Invoices are raised in the existing accounts package; this system prepares and records them.
