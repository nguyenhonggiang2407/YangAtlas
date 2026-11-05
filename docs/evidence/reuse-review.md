# YangAtlas plan reuse — independent review

Reviewed the existing personal v2 source and actual built app, then the owner's
reuse implementation. Reviewer edits are limited to the new
`work/YangAtlas/tests/e2e/reuse.mjs` and this report. No app, CSS, domain, build,
Git history or public deployment was changed by this reviewer.

All browser checks serve the actual `dist/` at a Pages-style `/YangAtlas/`
subpath through an ephemeral server owned by this test driver. Each scenario
uses a fresh headless Chromium context with an independent invented v2 fixture;
no persistent user browser profile or backend is used. All owned servers and
contexts have been closed.

## Two reproduced usability defects, fixed by the owner

1. **The selected final day disappeared from a long mobile day strip.** At
   390×844, selecting day 90 displayed the correct activity but a whole-app
   render reset `.days.scrollLeft` to 0. The active button occupied x=8117–8200
   while the strip occupied x=18–372. The user could see days 1–4, with no
   selected button on screen. The new regression failed with those measured
   bounds. The owner now reveals the active day inside its horizontal strip
   without scrolling the page vertically.
2. **Keyboard checklist completion lost focus.** Focusing “Sạc dự phòng” and
   pressing Space correctly saved `done:true`, but the newly rendered toggle
   was inactive because the original focused element was replaced. A second
   Space could not toggle the same item. The new regression failed at the
   focus assertion. The owner now restores the matching visible action/control
   after rendering. The regression checks two successive Space presses and
   verifies the final saved state, as well as focused day-90 selection.

The first focused run reproduced both issues (0/2). After the owner fixed them,
the two regressions and both new reuse workflows passed. No P0/P1 data-loss or
security defect was identified in this bounded review.

## Observed reuse behavior

The final local run used the owner's 32-file build revision
`ca226234c55bee462f81c132`. `node --test tests/e2e/reuse.mjs` passed **4/4** in
4.98 seconds, with no runtime errors, failed/missing resources, HTTP errors or
backend writes.

Desktop 1440×1000 and mobile 390×844 both exercised the actual “Nhân bản chuyến
đi” dialog. Cancelling retained the exact original saved state. A valid start
date whose 90-day trip would end beyond 2199 produced a visible validation error
and no mutation; a corrected date then created the new plan.

The source fixture contains visited activities on days 1 and 90, a multiline
address, estimates, both completed/incomplete preparation items, and a real
expense record entered as verification data. The copy retained the plan's
destination, cover, days, party size, limit, times, durations, addresses, notes
and estimated costs, with new IDs for the trip and every copied entity. Every
activity/checklist completion reset to false, and actual expenses started empty.
The original trip, including its completed work and 450,000 VND recorded expense,
remained exactly unchanged.

Actual downloadable JSON contained both independent trips and survived reload.
Actual ICS contained both events on their new dates (1 February and 1 May 2033)
and preserved the multiline `LOCATION`; source payment records were absent.
The displayed copy estimate remained 260,000 VND while actual spending was zero.
Completing a copied checklist item did not change the source item. The mobile
dialog fit the viewport, kept focus during eight forward and eight reverse Tab
steps, and restored focus on cancellation. Neither viewport overflowed.

## Visual/source review limits

Viewed the actual 390 px screenshots of the reuse dialog, new plan and selected
day 90. Both cover actions fit, dialog fields and the summary were readable,
and the final-day chip remained visible. These observations concern one
headless Chromium viewport, not physical-device or full accessibility
certification.

Actual captures are under `work/YangAtlas/artifacts/reuse/`:
`duplicate-dialog-mobile.png`, `duplicate-mobile.png`, `duplicate-desktop.png`
and `last-day-mobile.png`. Images were neither generated nor edited.

Read-only inspection found no additional actionable regression in the existing
empty-import or stale-tab safeguards; their previously passed v2 workflows were
not rerun here. The unchanged 17-case suite was intentionally not repeated
before the new work. Final exact-commit CI/public deployment checks belong to
the publishing owner; this report makes no new hosted/public claim.
