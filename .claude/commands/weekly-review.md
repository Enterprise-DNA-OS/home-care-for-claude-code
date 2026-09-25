---
description: The Monday review, written from three commands - what needs a decision, how the money and budgets sit, and whether next week's roster is covered and compliant.
---

1. Run three commands, `--json` each: `node scripts/care.mjs attention`, `node scripts/care.mjs agreements`, `node scripts/care.mjs roster`.
2. Write the review in four short sections, prose plus small tables, nothing invented:
   - **Today's decisions.** The attention list, worst first, one action each. An unreported reportable incident or an unscreened rostered worker is the first line of the whole review.
   - **The money.** Unclaimed total and oldest days, rejected claims and their reasons, and which batch to build or resubmit this week.
   - **The budgets.** Agreements under pace, over budget, expiring or unsigned, each with the client and the conversation to have.
   - **Next week.** Roster coverage: uncovered clients, unconfirmed past shifts to resolve, clearances expiring inside 30 days.
3. End with at most five actions for the week, each one doable with a single command or phone call.
4. If the operator wants it on paper, `npm run view` renders the week and money pages in the business's brand.
