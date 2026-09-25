# Moving off ShiftCare

Switch in a day: export from ShiftCare, create your service agreements, run
the import, read the attention list. This guide says exactly what maps and
what deliberately does not carry over.

## 1. Export from ShiftCare

ShiftCare's screens export to CSV (and its reports print to CSV). You want
four files:

| File | Where in ShiftCare | Columns the import reads |
|---|---|---|
| `clients.csv` | Clients list export | Name (or First/Last Name), NDIS Number, Date of Birth, Address, Suburb, Mobile/Phone, Email, Funding |
| `staff.csv` | Staff list export | Name, Mobile/Phone, Email, and the NDIS check expiry column if your account tracks it |
| `shifts.csv` | Shifts / timesheet report export for your date range | Date, Start Time, End Time, Client, Staff (or Carer), Status |
| `notes.csv` (optional) | Progress notes export | Date, Client, Author, Note |

Column names vary a little between ShiftCare plans; the importer matches the
common variants case-insensitively. Australian `DD/MM/YYYY` dates are read
correctly.

## 2. Create the service agreements first

This is the one manual step, and it is deliberate. ShiftCare's export gives
you shifts and prices, but not the agreement structure this system runs on:
which support item, at what rate, how many hours a week, against what budget,
between which dates, signed when. That structure is what makes claims,
budgets and the pace report work, so it is worth the twenty minutes:

```
node scripts/care.mjs items                       # check the price guide lines and caps
node scripts/care.mjs item add 01_011_0107_1_1 --name="..." --cap=67.56
node scripts/care.mjs agreement add "Client Name" --item=01_011_0107_1_1 --rate=65 --hours=6 --budget=12000 --starts=2026-01-01 --ends=2026-12-31 --signed=2025-12-15
```

One agreement per funded support line per client. Your service agreements and
plan documents have every number.

## 3. Import, dry-run first

```
node scripts/care.mjs import shiftcare --clients=clients.csv --workers=staff.csv --shifts=shifts.csv --notes=notes.csv --dry-run
node scripts/care.mjs import shiftcare --clients=clients.csv --workers=staff.csv --shifts=shifts.csv --notes=notes.csv
```

The dry run prints what it would create, update, and skip, by name. Re-running
the real import is safe: rows match on their ShiftCare id and update instead
of duplicating.

**The import is the first audit.** Every skip is a finding: a shift with no
covering agreement, a client name that does not match, a worker missing from
the staff export. Fix the cause and re-import; nothing is forced through.

## What maps

- Clients with their NDIS numbers, contact details and funding type
- Staff with contact details and screening expiry (add first aid dates by hand: `firstaid "Name" --expires=`)
- Shift history with dates, times, statuses (completed / cancelled / scheduled)
- Progress notes, attached to the client

## What deliberately does not carry over

- **ShiftCare's invoices and claim history.** Money already claimed stays in
  the old system's records and your accounting. This system claims what it
  delivers from day one; the crossover week is the moment to make sure nothing
  is claimed twice.
- **Documents and attachments.** Files in ShiftCare's storage are yours to
  download; keep them in your own drive. This system records supports, not
  files.
- **Clinical content.** Medication charts, health notes and care plans in the
  clinical sense do not belong here at all. This is the operations record.
- **Cancellation notice history.** ShiftCare's export does not carry notice
  periods, so imported cancellations arrive without a claimability call.
  Future cancellations record it at the gate.
- **The roster template.** Recurring patterns are re-rostered here with
  `shift add`, through the gates, which is the point: every shift going
  forward is screened, agreement-covered and clash-checked.

## 4. Afterwards

Run `/attention`. The first run on real data usually says more than the old
system's dashboard ever did: unnoted shifts, unclaimed work, clearances about
to lapse, budgets off pace. Then check `claim export` column order against
the current NDIA bulk payment request template (the NDIS provider portal
publishes it) before your first real upload.
