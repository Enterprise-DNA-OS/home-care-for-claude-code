# Home Care for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR ORGANISATION], a home care / NDIS provider in [region, Australia]
- **Operator:** [YOUR NAME], [director / coordinator / roster desk]
- **Registration:** [NDIS registration number and registration groups, or "unregistered, plan and self managed clients only"]
- **The work:** [roughly what: daily living supports, community access, household tasks; how many clients and workers]
- **Who submits Commission notifications:** [name them: reportable incidents have a 24 hour clock and someone owns it]
- **What matters most:** [for example: no unscreened worker ever rostered, every delivered hour claimed inside a week, notes same day]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a client, a worker or an incident, read the whole card first: `client <name>`, `worker <name>`, `incidents --all`.
3. **Plain language.** Short sentences. No filler. Numbers in tables. The industry's words, not software words: a participant, a support item, a service agreement, a progress note, a payment request, a plan manager, a screening clearance, a reportable incident.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or goes to a client, a family, a plan manager or the Commission waits for a yes in this session.
6. **Never invent a fact.** Rates, dates, hours and clearances come from the record. If a fact is missing, ask for that one fact.
7. **Never rule on the law.** This system records the dates and enforces the gates; whether a specific incident is reportable, or a specific support claimable, is the operator's call on the rules, never yours. Point at `docs/compliance.md` and its sources.
8. **No clinical records.** Medications, diagnoses and health notes do not enter this system, in any field, ever. Progress notes are operational.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs a decision today | `/attention` |
| The roster, this week or any week | `/roster` |
| Put a shift on | `shift add "Client" --worker= --on= --start= --end=` |
| The shift happened | `shift done SH-xxxx --note="..." [--minutes=]` |
| The client cancelled | `shift cancel SH-xxxx --reason= --notice=<days>` |
| The clients and their pulse | `/clients` |
| One client, before any conversation | `/client` |
| A new client coming on | `/new-client` |
| The workers and their clearances | `/team` |
| A clearance renewed | `screening "Name" --expires=` / `firstaid "Name" --expires=` |
| A new worker | `add worker "Name" --screening= --screening-number=` |
| How the budgets sit | `/budgets` |
| A new funded support line | `agreement add`, then `agreement sign` when the ink lands |
| The price guide moved | `item add <number> --name= --cap=` |
| Who owes us, claim week | `/claims` |
| Build and export the batch | `claim build`, then `claim export --batch=` |
| Remittance landed | `claim paid PR-xxx` |
| A claim bounced | `claim reject CLM-xxxx --reason=`, fix, `claim resubmit CLM-xxxx` |
| Something happened | `/incidents`, `incident add` |
| The Commission was notified | `incident notify INC-xx --on=` |
| A note about a call or a change | `/log` |
| The Monday review | `/weekly-review` |
| Are we compliant, what would an audit find | `/compliance` |
| The statement a plan manager wants | `/draft-service-statement` |
| The Commission notification content | `/draft-incident-notification` |
| The email that goes with a claim batch | `/draft-claim-cover` |
| Bring us over from ShiftCare | `/import` |
| Change how this system works | `/customise` |
| A new page to look at | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run care -- help`) and then propose a new command for it.

## Hard rules

- **A worker without a current NDIS Worker Screening clearance on the shift date does not go on the roster.** `shift add` refuses, there is no force flag, and you never work around it (Worker Screening Rules 2018). When a clearance lapses under an existing roster, the fix is reassignment or renewal, today.
- **No shift outside a signed, in-date service agreement.** Supports delivered outside one are unclaimable; `shift add` refuses.
- **A completed shift without a progress note cannot be claimed.** `shift done` requires the note. No note, no evidence, no claim.
- **No rate above the support item's price limit.** `agreement add` refuses; update the caps from the current Pricing Arrangements first if the guide has moved.
- **A reportable incident does not close without its Commission notification date.** `incident close` refuses (Incident Management and Reportable Incidents Rules 2018). The notification itself is submitted by a person in the Commission portal.
- **Nothing here connects to the NDIA, a bank, or a client, and nothing sends.** Claims export to `exports/` for a person to upload; statements and notifications draft to `docs-out/` and `drafts/`; a person sends.
- **Never delete records.** Clients exit, workers become former, claims stay. The delivery record is the registration's 7 year evidence tail and, in an audit, the defence.
- **Never invent a record.** If a name or a reference is ambiguous, list the candidates and ask. The CLI already does this.
- The database is the source of truth. If the answer is not in it, say so.

## Words this business uses

- A **participant** (client) is funded by an NDIS **plan**; the plan's end date is the **reassessment** clock. Funding is **NDIA managed** (claims go through the portal), **plan managed** (invoices go to the plan manager), **self managed**, or private.
- A **service agreement** is the funded line every shift hangs off: this support item, this rate, this many hours a week, this budget, between these dates, **signed**. No agreement, no roster.
- A **support item** is a line in the **NDIS Pricing Arrangements and Price Limits** with a price cap. The caps in this system are yours to keep current from the guide.
- A **progress note** is the operational record that a support was delivered and what was done. It is the audit evidence and the claim's foundation.
- A **payment request** (claim) turns a delivered shift into money: minutes at the agreement's rate, batched into a **bulk upload** file for the portal or an invoice line for the plan manager.
- A **short-notice cancellation** (under 7 clear days) is claimable at 100% under the Pricing Arrangements; more notice is not claimable, and that is correct.
- A **reportable incident** goes to the **NDIS Commission**: 24 hours for deaths, serious injuries, abuse or neglect allegations and unauthorised restrictive practices; 5 business days for the rest.
- The **NDIS Worker Screening Check** is the clearance every worker delivering supports must hold; **WWCC** is the working with children check where required; first aid is policy.

## Where things live

- `scripts/care.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it. Never edit an applied migration; add the next one.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `brand.json`, `views.json`, `documents.json` the HTML output: whose name is on it, what pages, what paperwork.
- `docs/compliance.md` the rules `/compliance` checks, each with its source. `docs/replace-shiftcare.md` moving off the incumbent. `docs/why-no-front-end.md` the honest trade-offs.
- `exports/` claim upload files and whole database dumps. `drafts/` and `docs-out/` anything written for a person to send.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/shiftcare
