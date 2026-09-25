---
description: The client list with the delivery pulse per client - funded hours, hours delivered, last and next shift, unclaimed money, plan end dates.
---

1. Run `node scripts/care.mjs clients --json` (`--all` to include exited clients).
2. Present as a table. Call out: anyone with no next shift (a funded client with an empty week), anyone with a plan ending inside 6 weeks, anyone with unclaimed money.
3. For one client's whole story, use `/client`.
