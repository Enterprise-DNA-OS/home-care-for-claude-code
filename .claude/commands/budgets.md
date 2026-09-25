---
description: Every service agreement's money and pace - rate, used vs budget, percent used against percent of the period gone, end dates. Under-delivered budgets are plan review risk; over-delivered ones are unfunded work.
---

1. Run `node scripts/care.mjs agreements --json`.
2. Present with used% beside time%. The states tell the story: `under pace` means the plan review will read unused funding as unneeded funding; `OVER BUDGET` means stop and talk to the plan manager; `expiring` means get the renewal signed; `UNSIGNED` means it does not roster.
3. For each non-ok agreement, one line: the client, the gap, the action.
4. New funded line: `agreement add "Client" --item= --rate= --hours= --budget= --starts= --ends= --signed=`. The rate gate holds at the item's price limit; update caps first (`item add`) if the price guide has moved.
