<h1 align="center">Home Care for Claude Code</h1>

<p align="center">
  <strong>The open-source home care and NDIS provider system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, a web front end if you want one, your ShiftCare data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/shiftcare">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-shiftcare-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-shiftcare">Instead of ShiftCare</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Home Care for Claude Code does the job you pay ShiftCare, Brevity or AlayaCare for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and run the provider in plain language. It runs the right query, and it can answer questions the incumbent's dashboard cannot.

ShiftCare's own pricing page runs per active staff member per month across four tiers, and support rosters are heavy with casuals, so the bill scales with headcount whether or not those casuals ever open the app. The NDIS features sit up the ladder: invoicing arrives in the middle tier, incident management and client fund tracking in the one above it. What a home care provider actually needs to hold is ordinary: the clients, the service agreements that fund their supports, the workers with their clearances, the roster, the progress notes that prove delivery, the incident register, and the payment requests. That is eight Postgres tables, and the "care management dashboard" the incumbent sells is a handful of SQL views over them.

This repo is that record over Postgres, with the asking done by the agent you already have:

```
/attention                  everything that wants a decision this morning, worst first
/roster                     the week ahead, plus every past shift left unresolved
/clients                    the delivery pulse per client
/client                     one client's whole card before any conversation
/team                       the workers, clearance state loud
/budgets                    every agreement's money against its pace
/claims                     unclaimed work, batches in flight, rejections with reasons
/incidents                  the register, with the Commission clock running
/weekly-review              the Monday review, written from three commands
/compliance                 nine rules from the NDIS rulebooks and your own standards
```

The sharp edges are deliberate, because this is the industry where soft edges become registration findings:

- **A worker without a current NDIS Worker Screening clearance on the shift date does not go on the roster.** The Worker Screening Rules 2018 require it, the CLI refuses, and there is no force flag.
- **A shift is not rostered outside a signed, in-date service agreement**, because supports delivered outside one cannot be claimed.
- **A completed shift without a progress note cannot be claimed.** The note is the evidence that the support was delivered; no note, no evidence, no claim.
- **An agreement rate never passes the support item's price limit**, so an over-cap claim cannot be built here at all.
- **A reportable incident does not close until its NDIS Commission notification is on record.** The 24 hour clock belongs to the Commission, not to you.

**Nothing here connects to the NDIA, a bank, or a client, and nothing sends.** Claims export to a file a person uploads; statements and notifications draft to files in your brand; a person sends them. There are no clinical records here by design: no medications, no diagnoses. Nothing here is legal advice.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your delivery record sits in plain Postgres tables you own. Any tool can read them. No export request, no access ending when a subscription does.
- No per-staff pricing, no tiers, no feature ladders. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/home-care-for-claude-code.git
cd home-care-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Fernbank Community Care (a demo Geelong NDIS provider with a fortnight going quietly wrong: a serious injury incident three days old with no Commission notification, a worker rostered three shifts next week on a screening clearance that expired twelve days ago, about $1,900 of delivered support nobody has claimed, three completed shifts with no progress note, two rejected claims, an agreement ending in 24 days, a budget at 12% used with 67% of the period gone, and a funded client with an empty week ahead), then prints the attention list, the unclaimed money and the compliance check.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/claims`, `/team`, `client ruby`, `budgets`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md), especially your registration groups and who submits Commission notifications, and put your name, colours and NDIS registration number in [brand.json](brand.json) so every statement and export carries them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. A provider shares one database: the coordinator, the roster desk and the bookkeeper each clone the repo, point at the same `DATABASE_URL`, and work in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first: an unreported reportable incident outranks all. |
| `/roster` | The week ahead plus anything unresolved; add, complete and cancel shifts through the gates. |
| `/clients` | Every client's delivery pulse: funded hours, delivered hours, next shift, unclaimed money. |
| `/client` | One client's whole card: agreements, shifts, notes, incidents, money. |
| `/team` | The workers with screening and first aid state loud, and next week's load. |
| `/budgets` | Used against budget against elapsed time, per agreement; under pace and over budget named. |
| `/claims` | The claim week ritual: unclaimed work, build the batch, export the upload file, fix rejections. |
| `/incidents` | The incident register with the Commission deadlines running. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/compliance` | Nine rules from the NDIS rulebooks and your own standards, run against your records, sources cited. |
| `/new-client` | Client, agreement, first shifts, in the order the gates expect. |
| `/log` | A progress or file note: calls, family conversations, changes. In an audit, the record. |
| `/draft-service-statement` | The statement of supports a plan manager asks for, in your brand. Drafts only. |
| `/draft-incident-notification` | The Commission notification content, drafted from the record. Drafts only. |
| `/draft-claim-cover` | The covering email for a claim batch to a plan manager. Drafts only. |
| `/import` | Bring the business across from ShiftCare or plain CSV. The import is the first audit. |
| `/customise` | Add a field, change a rule, rename things, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run care -- help`. Any read command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # client statements, incident reports, audit-ready worker files
npm run view    # the week and the money, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your business name, logo, colours and NDIS registration number are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser; the worker file is the audit question answered in advance. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached, each rule citing its source. The CLI enforces the sharpest ones at the gate: unscreened workers do not roster, unsigned agreements do not roster, unnoted shifts do not claim, over-cap rates do not exist, reportable incidents do not close unnotified.

1. Every worker delivering supports holds a current NDIS Worker Screening clearance (Worker Screening Rules 2018).
2. Every completed shift has a progress note: the record that the support was delivered (Practice Standards, records of supports).
3. Reportable incidents are notified to the NDIS Commission inside the deadline: 24 hours for the serious kinds (Incident Management and Reportable Incidents Rules 2018).
4. No rate above the support item's price limit (NDIS Pricing Arrangements and Price Limits).
5. Every scheduled shift sits inside a signed, in-date service agreement (Practice Standards; the NDIA's terms of business).
6. Cancellation claimability follows the short-notice rule: less than 7 days' notice claims at 100%, more does not (Pricing Arrangements).
7. Active support workers hold current first aid (your own policy, and what auditors expect).
8. Budgets are delivered at roughly the planned pace: under-delivery is plan review risk, over-delivery is unfunded work (your own standard).
9. Records are never deleted: clients exit, workers become former, claims stay, for the 7 years the rules require (Provider Registration and Practice Standards Rules 2018).

Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your registration.

## Ten questions ShiftCare cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. How much delivered support has no payment request built, per client, and how old is the oldest dollar?
2. Which workers rostered next week will have an expired screening clearance on the day of the shift?
3. Which completed shifts this month have no progress note, by worker, before the auditor asks?
4. Which agreements are running so far under pace that the plan review will read the funding as unneeded, and by how much?
5. Which reportable incidents are past their Commission deadline right now?
6. What did each rejected claim bounce for, and how much money is stuck in rejections in total?
7. Which funded clients have an empty week ahead?
8. What is the short-notice cancellation pattern by client, and how much of it was claimable under the rules?
9. Which clients' plans end inside six weeks, and is their delivery record complete and claimed before reassessment?
10. If the auditor arrives Monday, whose worker file is incomplete: screening, first aid, or notes?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your business.

1. "Put our real clients, agreements and workers in, with the actual rates and budgets."
2. "Set our support items and price limits from the current Pricing Arrangements."
3. "Put our logo, colours and registration number on the statements and exports."
4. "Add sleepover shifts as a support item with its own rate shape."
5. "Import our ShiftCare exports, then show me what the old system never told us."
6. "Add a compliance rule: no shift without the worker's WWCC where the client is under 18."
7. "Track vehicle use per shift: kilometres, and the activity-based transport item to claim them under."
8. "Build a page per plan manager: their clients, what we have claimed, what is outstanding."
9. "When I build a claim batch, render the covering email for each plan manager in the same breath."
10. "Write a command that drafts the month-end delivery summary for our accountant."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of ShiftCare

Export your clients, staff and shift history from ShiftCare (its lists and reports export to CSV), create your service agreements, run one command, and the record comes with you. Step by step, with what maps and what deliberately does not carry over: [docs/replace-shiftcare.md](docs/replace-shiftcare.md).

```bash
npm run care -- import shiftcare --clients=clients.csv --workers=staff.csv --shifts=shifts.csv --dry-run
npm run care -- import shiftcare --clients=clients.csv --workers=staff.csv --shifts=shifts.csv
```

The import is the first audit: a shift with no covering agreement, or a client whose funding type nobody recorded, is loud the moment the import finishes.

## Architecture

```
home-care-for-claude-code/
  CLAUDE.md                 how the provider wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  brand.json                your name, logo, colours and NDIS registration on every document
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  scripts/care.mjs          the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-shiftcare.md moving off the incumbent
  docs/why-no-front-end.md  the honest trade-offs
  exports/                  claim upload files and whole database dumps
  drafts/                   anything written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, no clinical records, nothing that sends, and the screening, agreement, note, price limit and incident gates stay.

## Want it installed and run for you?

Enterprise DNA installs Home Care for Claude Code for your organisation, migrates your ShiftCare data, writes your registration's rules in as commands, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/shiftcare

## License

MIT. Copyright (c) 2026 Enterprise DNA.
