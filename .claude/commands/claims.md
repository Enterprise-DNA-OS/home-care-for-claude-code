---
description: The payment request position - what is unclaimed, what is in flight, what came back rejected. The claim week ritual - build the batch, export the upload file, mark paid, fix rejections.
---

1. Run `node scripts/care.mjs unclaimed --json`, then `node scripts/care.mjs claims --json`.
2. Lead with the money: the unclaimed total and its oldest days, then rejections (each with its recorded reason: the reason IS the fix instruction), then what is in flight.
3. The ritual, in order:
   - Shifts with NO NOTE are not here and cannot be: chase the notes first (`/attention` names them).
   - `claim build` mints the next PR batch from everything claimable (add `--dry-run` to preview, `--client=` to scope).
   - `claim export --batch=PR-xxx` writes the bulk upload CSV to `exports/`. A person uploads it in the myplace portal or hands it to the plan manager; nothing is sent from here.
   - When remittance lands: `claim paid PR-xxx`. When a line bounces: `claim reject CLM-xxxx --reason="what the portal said"`, fix the cause, `claim resubmit CLM-xxxx`.
4. Never edit a claim's amount by hand: the amount is minutes at the agreement's rate, and that is the point.
