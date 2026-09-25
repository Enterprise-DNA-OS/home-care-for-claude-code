# The rule book `/compliance` checks

Each rule names its source, what a breach looks like in the data, and how the
system finds it. `node scripts/care.mjs compliance` runs them all;
`compliance <key>` runs one. The sharpest rules are also enforced at the gate,
so the breach cannot be created from inside this system in the first place.

Nothing here is legal advice. These are the rules this operator has told the
system to enforce, with their sources. When your registration, your state, or
the current NDIS rules differ, change the rule and this doc together, and do
not guess at law: check the source.

## 1. `screening`: every worker delivering supports holds a current NDIS Worker Screening clearance

- **Source:** NDIS (Practice Standards - Worker Screening) Rules 2018; NDIS Worker Screening Check (state-run, national database).
- **Breach in the data:** an active worker whose `screening_expires_on` is missing or past, holding scheduled shifts today or later.
- **The gate:** `shift add` refuses a worker without a current clearance on the shift date. No force flag. The check can still breach when a clearance expires *after* rostering, which is exactly what the attention list watches for.

## 2. `notes`: every completed shift has a progress note

- **Source:** NDIS Practice Standards and Quality Indicators (provider governance and operational management: records of supports delivered); NDIS (Provider Registration and Practice Standards) Rules 2018.
- **Breach in the data:** a shift in status `completed` with no row in `progress_notes` pointing at it.
- **The gate:** `shift done` requires `--note=`. Breaches come from imported history or direct SQL, and from nowhere else. An unnoted shift is also unclaimable: it never enters `v_unclaimed`.

## 3. `incidents`: reportable incidents are notified to the NDIS Commission inside the deadline

- **Source:** NDIS (Incident Management and Reportable Incidents) Rules 2018: 24 hours for deaths, serious injuries, allegations of abuse or neglect, unlawful conduct and unauthorised restrictive practices (with a 5 business day fuller report), 5 business days for other reportable incidents.
- **Breach in the data:** an incident with `reportable = true` and no `notified_on`.
- **The gate:** `incident close` refuses a reportable incident with no notification date. The notification itself happens in the Commission portal, by a person; this system records that it happened and shouts while it has not.

## 4. `price-limits`: no rate above the support item's price limit

- **Source:** NDIS Pricing Arrangements and Price Limits (updated at least annually; the caps in `support_items` are yours to maintain from it).
- **Breach in the data:** an agreement whose `rate_cents` exceeds its item's `price_cap_cents`.
- **The gate:** `agreement add` refuses an over-cap rate, and every claim inherits its agreement's rate, so an over-cap claim cannot be built here.

## 5. `agreements`: every scheduled shift sits inside a signed, in-date service agreement

- **Source:** NDIS Practice Standards (service agreements with participants); the NDIA's terms of business for registered providers.
- **Breach in the data:** a scheduled future shift whose agreement is unsigned, or whose date falls outside the agreement's start and end dates.
- **The gate:** `shift add` refuses both. Breaches appear when an agreement lapses under an existing roster, which the attention list reports as `agreement_lapsed`.

## 6. `cancellations`: claimability follows the short-notice rule

- **Source:** NDIS Pricing Arrangements and Price Limits, short-notice cancellation provisions (less than 7 clear days' notice: claimable at 100% of the agreed price; more notice: not claimable).
- **Breach in the data:** a cancelled shift with no notice period recorded, or a `claimable` flag that contradicts its notice period.
- **The gate:** `shift cancel` requires `--notice=` and sets `claimable` from it. If your service agreements set a different cancellation window, change the rule in `scripts/care.mjs` and this doc together.

## 7. `first-aid`: active support workers hold current first aid

- **Source:** your own policy. Most service agreements, insurers and auditors expect it; some state rules require it for specific supports.
- **Breach in the data:** an active support worker whose `first_aid_expires_on` is missing or past.

## 8. `utilisation`: budgets are delivered at roughly the planned pace

- **Source:** your own standard. Under-delivery reads as unneeded funding at plan reassessment; over-delivery is unfunded work you will not be paid for.
- **Breach in the data:** an agreement whose used percentage runs at less than 70% of the elapsed-time percentage (once a quarter of the period has passed), or whose delivered value exceeds its budget.

## 9. `retention`: records are never deleted

- **Source:** NDIS (Provider Registration and Practice Standards) Rules 2018 (records of supports kept for at least 7 years).
- **In practice:** there is no delete verb in the CLI. Clients exit, workers become former, claims stay. The check passes by construction and exists so nobody adds a delete verb without reading this file.
