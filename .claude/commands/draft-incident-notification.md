---
description: Draft the content of an NDIS Commission reportable incident notification from the incident record, for the operator to submit in the Commission portal. Drafts only; recording the submission is `incident notify`.
---

1. Run `node scripts/care.mjs incidents --all --json` and read the full incident (and the client card) before writing a word.
2. Draft to `drafts/incident-notification-INC-xx.md` with the fields the Commission's portal asks for: provider details (from `brand.json`), participant details, what happened (factual, from the record), when and where, who was involved, immediate actions taken, who has been informed, planned follow-up. Flag every field the record cannot fill as [OPERATOR TO CONFIRM] rather than guessing.
3. Say the deadline out loud: 24 hours for serious reportable incidents, 5 business days otherwise (Incident Management and Reportable Incidents Rules 2018), counted from when the provider became aware.
4. The operator submits it in the portal themselves. The moment they have: `incident notify INC-xx --on=<date>`, and only then can the incident close.
5. Nothing here is legal advice, and nothing sends from here.
