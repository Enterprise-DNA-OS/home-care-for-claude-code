---
description: Write a progress note or file note against a client - a phone call, a family conversation, a change request, an observation. In an audit or a dispute, the notes are the record.
---

1. Identify the client (and worker, if the operator names one). If ambiguous, list candidates and ask.
2. Run `node scripts/care.mjs note add "<client>" "<the note, in plain factual language>" [--worker=] [--shift=SH-xxxx] [--on=]`.
3. Completed-shift notes normally arrive through `shift done --note=`; use `--shift=` here only to attach a late note to a shift that already exists.
4. Keep notes operational: what happened, who said what, what was agreed. No clinical content, no speculation. Confirm in one line what was recorded and where.
