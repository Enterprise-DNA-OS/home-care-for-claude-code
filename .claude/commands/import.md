---
description: Bring the business across from ShiftCare (or any rostering system that exports CSV) - clients, staff, shift history, notes. The import is the first audit.
---

1. Read `docs/replace-shiftcare.md` first: it says what to export from ShiftCare, what maps, and what deliberately does not carry over.
2. Order matters: import clients and workers first, then create the service agreements (`agreement add` per funded support line - ShiftCare's price book does not export the agreement structure, and shifts cannot land without one), then import shifts, then notes.
3. Always dry-run first: `node scripts/care.mjs import shiftcare --clients= --workers= --shifts= --notes= --dry-run --json`. Walk the operator through the counts and every named skip before running it for real.
4. Re-running is safe: rows match on their ShiftCare id and update instead of duplicating.
5. The skips are the audit: a shift with no covering agreement, an unknown client or worker, unreadable times. Fix the cause (usually a missing agreement) and re-import rather than forcing anything.
6. When it is in, run `/attention` and show the operator what the old system never told them.
