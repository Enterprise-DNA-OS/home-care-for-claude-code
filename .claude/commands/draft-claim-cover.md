---
description: Draft the covering email that goes with a payment request batch to a plan manager, with the batch's lines summarised from the record. Drafts to drafts/; a person sends.
---

1. Run `node scripts/care.mjs claims --batch=PR-xxx --json` and `node scripts/care.mjs claim export --batch=PR-xxx --json` if the CSV is not already in `exports/`.
2. Group the batch's lines by plan manager (the client card says who manages each plan). One draft per plan manager, to `drafts/claim-cover-PR-xxx-<plan-manager>.md`.
3. The draft is short and factual: the period, the clients (first name and NDIS number), hours and amounts per support item, the total, and the CSV attached by the sender. No pleading, no filler.
4. Never draft to the NDIA itself: NDIA-managed lines are uploaded in the portal, not emailed.
5. A person attaches the file and sends. Nothing sends from here.
