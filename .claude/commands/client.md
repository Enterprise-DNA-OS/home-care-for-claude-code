---
description: One client's whole card before any conversation - agreements and their pace, recent and upcoming shifts, progress notes, incidents, unclaimed money. Read this before drafting anything about a client.
---

1. Run `node scripts/care.mjs client "<name>" --json` (partial name or NDIS number both work; if it lists candidates, ask which).
2. Present: the profile line, then agreements with used vs budget and their state, then recent shifts, upcoming shifts, the latest notes, and any incidents.
3. Say the one thing that needs doing, if anything does: an expiring agreement, an empty week ahead, an open incident, money unclaimed.
4. To add a note from this conversation: `note add "<client>" "..."`. Records only; never send anything to a client or family from here.
