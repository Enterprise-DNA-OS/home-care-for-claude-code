---
description: The incident register with the NDIS Commission clock running. Record incidents, record Commission notifications, close them - a reportable incident does not close without its notification date.
---

1. Run `node scripts/care.mjs incidents --all --json`.
2. Lead with anything in state NOTIFY OVERDUE or `notify due`: say the deadline plainly (24 hours for serious reportable incidents, 5 business days otherwise, under the Incident Management and Reportable Incidents Rules 2018). That notification is the operator's job today; this system only records that it happened.
3. To record: `incident add "Client" "what happened, factually" --category= --severity= [--worker=] [--reportable] [--on=]`. Serious incidents, abuse or neglect, and unauthorised restrictive practices are reportable automatically. Keep descriptions operational: what happened, who was told, what was done. No clinical content.
4. `incident notify INC-xx [--on=]` records the Commission notification. `incident close INC-xx` closes it, and will refuse a reportable incident with no notification on record: that refusal is correct, do not route around it.
5. `/draft-incident-notification` drafts the notification content for the operator to submit.
