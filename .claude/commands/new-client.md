---
description: Bring a new client on properly - the record, the funded agreement, the first shifts - in the order the gates expect.
---

1. `node scripts/care.mjs add client "Name" --ndis= --dob= --address= --suburb= --phone= --email= --funding= --plan-manager= --plan-ends=`. Funding is ndia_managed, plan_managed, self_managed or private; it decides where the claims go later.
2. The agreement next, one per funded support line: `agreement add "Name" --item= --rate= --hours= --budget= --starts= --ends= --signed=`. If the support item is not in `items`, add it first with its price limit from the current price guide (`item add`). Unsigned agreements do not roster: if the signature is pending, say so and record it later with `agreement sign`.
3. Then the roster: `shift add` per shift. The gates check the worker's screening and the agreement dates; relay any refusal as-is.
4. Close with the client card (`node scripts/care.mjs client "Name"`) so the operator sees what the system now knows, and note anything still missing (plan end date, emergency contact).
