---
description: The support workers with clearance state loud - NDIS Worker Screening and first aid expiry, roster load next week, hours worked last fortnight. The Friday check before next week's roster goes out.
---

1. Run `node scripts/care.mjs workers --json` (`--all` includes former workers).
2. Present with the clearance columns first. EXPIRED or NONE screening means they cannot be rostered: if they hold upcoming shifts, that is the headline, name the shifts (`node scripts/care.mjs worker "<name>" --json`).
3. `expiring` screening (30 days out) gets a reminder line: renewals take weeks.
4. Record renewals the moment the certificate arrives: `screening "<name>" --expires= [--number=]`, `firstaid "<name>" --expires=`.
