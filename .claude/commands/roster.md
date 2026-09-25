---
description: The roster. Default is the week ahead plus anything unresolved (past shifts never confirmed, completed shifts with no note). Filter by day, client or worker; add, complete or cancel shifts on request.
---

1. Run `node scripts/care.mjs roster --json` (add `--day=`, `--client=`, `--worker=`, `--past` or `--all` if the operator scoped it).
2. Present by day. Make the loud states loud: UNCONFIRMED and NO NOTE rows go first with what to do about each.
3. To roster: `shift add "Client" --worker= --on= --start= --end=`. The gates will refuse an unscreened worker, a missing or unsigned agreement, or a double booking; relay the refusal as-is, it says what to fix. Never work around a gate.
4. To confirm what happened: `shift done SH-xxxx --note="the worker's account" [--minutes=]`. To cancel: `shift cancel SH-xxxx --reason= --notice=<days>` and tell the operator whether it came out claimable.
