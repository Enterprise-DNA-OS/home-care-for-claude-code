---
description: Render one client's statement of supports delivered - the document plan managers and self-managed participants ask for - in the business's brand. Drafts to a file; a person sends it.
---

1. Identify the client. Run `node scripts/care.mjs client "<name>" --json` and read the card first.
2. Run `npm run docs -- client-statement` (it renders every eligible client; name the one file the operator wants from `docs-out/client-statement/`).
3. Open the HTML and check it reads right: agreements, supports delivered in the window, payment requests. The numbers come from the record; if one looks wrong, the fix is the record, never the document.
4. If a covering message is wanted, draft it to `drafts/` in plain language: period covered, hours delivered, amount claimed, who to contact. Nothing sends from here.
5. Branding (name, logo, colours, NDIS registration number) comes from `brand.json`.
