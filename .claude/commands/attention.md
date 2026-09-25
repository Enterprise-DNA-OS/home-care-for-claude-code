---
description: Everything that wants a decision this morning, worst first. An unreported reportable incident outranks everything, then screening breaches, then unconfirmed shifts, missing notes and money sitting unclaimed.
---

1. Run `node scripts/care.mjs attention --json`.
2. Present it worst first, grouped by reason, in the industry's words. Lead with anything rank 1 or 2 (an unreported reportable incident, an unscreened worker still rostered): those are today's first phone calls, say so plainly.
3. For each group, say the one action that clears it: `incident notify INC-xx`, reassign the shifts and `screening`, `shift done`/`shift cancel` for unconfirmed shifts, chase the worker's note, `claim build`, `claim resubmit`.
4. If the list is empty, say so in one line and stop.
