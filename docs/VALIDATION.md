# Verification

## Trip reuse and interaction refinements — v2.1, 5 November 2026

- **50/50 native checks passed locally:** the previous 40 plus 6 trip-duplication
  checks and 4 regressions for the real UI's asynchronous update/reload policy.
- **4/4 focused new browser cases passed:** desktop/mobile plan reuse, final-day
  visibility in a 90-day trip, and repeated keyboard checklist toggling. These
  cover cancellation and invalid dates without mutation, fresh IDs, preserved
  source payments/completion, reset copy state, independent JSON data and calendar
  events on the new dates. The unchanged 17 flows will run alongside these in CI.
- Local review reproduced the initiating-tab update race using the actual app
  and a RAM-only waiting-worker response that delays activation. Production
  source/artifacts were not substituted. The new final reload guard preserves an
  open form or protected in-memory changes that appeared after update acceptance.
  Both actual fixed-browser scenarios passed: the initiating tab kept its new
  form, the other tab kept its draft, and a protected in-memory activity remained
  visible and available in a real JSON download after activation. See the
  [local before/after review](evidence/update-race-review.md). These are local
  controlled-timing checks, not artificial traffic to the public deployment.
- Syntax, static build, all 12 existing licensed photo/font hashes and diff checks
  passed. Data remains schema v2 with the same browser storage key and backup limits.

## Personal application v2 — 5 November 2026

The personal release adds arbitrary destinations and addresses, a separate actual
expense ledger, CSV export, preparation checklists, complete printing, v1 data
migration, empty workspaces and installable offline use. It follows the requested
account-free, browser-local model.

- **40/40 native checks passed locally:** 31 domain/migration/export checks and
  9 offline lifecycle/build checks. These include realistic backups above the old
  1 MiB boundary, explicit collection limits, actual versus estimated expenses,
  formula-looking CSV text, ICS LOCATION, cache integrity, update waiting and
  isolation from other apps and non-GET/third-party requests.
- Syntax, deterministic build and all **12 existing photo/font hashes passed**.
  The build publishes **32 files**, including a generated service worker and
  relative install manifest. All 31 other resources have precache SHA-256 integrity.
- The initial full browser run passed 16/17 cases; a prefilled-textarea locator
  failed before an edit. The same migration case passed after selecting the
  semantic textbox, without a product workaround. All 17 cases have passed;
  focused final mobile/offline/export checks also passed. Hosted CI will run the
  complete 17 on one exact source commit before publication.
- Root inspected actual local desktop 1440px and mobile 390px captures: blank
  workspace, itinerary and expense ledger, loaded photographs/fonts, no horizontal
  overflow or runtime errors. Offline readiness was reported by the installed worker.
- Independent review reproduced an address line-break loss on unrelated edits
  and an inherited-property destination alias. Both were fixed (textarea and
  own-property lookup). The final built release passed focused regressions for
  multiline address edit/JSON/ICS/map fidelity and the literal `constructor`
  destination, alongside genuine offline navigation/edit/reload.

### Verified public v2 release

Application commit `6b9f6cefa81f062b7b09493e496b2e0a8ec9b3e4`. [CI41951152367](https://github.com/nguyenhonggiang2407/YangAtlas/actions/runs/41951152367) completed successfully: **40/40 native tests, 17/17 browser workflows**, 12 photo/font hashes, build and Pages publication. The development dependency installation reported zero advisories at that run. [Decoded CI excerpts](evidence/personal-ci-verification.json).

Independent public checks on **5 November 2026, 01:52:24–01:52:48 UTC** passed **all 32 HTTP200 resources with exact SHA-256**, plus the root document. Expected files were reconstructed from canonical Git bytes at the exact application commit, including the generated integrity-checked worker, matching Linux CI release `72996fdc74c9b8d20a99a93e`. This avoids differences from Windows checkout line endings.

Fresh Chromium 156 desktop 1440×1000 and mobile 390×844 contexts opened an empty workspace, created Huế trips with custom addresses, recorded actual expenses independently from estimates, reloaded checklist data and downloaded real JSON/CSV/ICS files including LOCATION. The installed worker cached 31 resources; with the network disabled a new page reopened, accepted edits and retained them after another offline reload. No browser/runtime/HTTP/request errors, unexpected third-party requests, backend writes or horizontal overflow were observed.

[Public observations, file hashes, downloads and screenshot timestamps](evidence/personal-live-verification.json). Four unedited public screenshots are published as `docs/screenshots/personal-*.png`; nine original captures and three downloaded files were delivered separately. All entered amounts are isolated verification data, not real payments. Native OS installation acceptance and physical printing were not exercised. These checks do not promise every browser, physical phone, storage retention or uptime.

The v1 evidence below is retained as a historical record, not substituted for v2 verification.

## Historical v1 release

Development date: 4 November 2026. Results below distinguish completed checks
from pending publication. They are not claims of production traffic or user counts.

- Domain:19 native Node tests passed, covering strict import, safe numeric/date
  bounds, leap years across three timezones, budget scope, cross-midnight overlaps,
  duration-preserving reorder and RFC5545 text/UTF-8/calendar rollover.
- Syntax and static build passed. The runtime does not include npm dependencies.
- Dependency installation reported zero advisories in the four-package development
  dependency tree at installation time. This is not a permanent vulnerability guarantee.
- Browser:10 real workflows passed under a GitHub Pages-style `/YangAtlas/`
  subpath. They cover trip/activity edits and reordering, party budgets, reload,
  library search/filter/add, overlaps, completion, atomic malformed/cancelled JSON
  import, JSON/ICS downloads, literal untrusted text, undo preserving later edits,
  390px layouts, corrupt saved data, quota denial and unavailable storage.
- A stronger mobile keyboard follow-up found a Tab-boundary/focus issue. After
  fixing it, the focused check passed12 forward and12 reverse Tab steps plus
  Escape and visible focus restoration. An earlier attempt hit an8-second startup
  wait; an unchanged retry passed with no page errors or missing assets. Hosted CI
  will verify the complete final source on Linux before publication.
- Desktop/mobile real captures were inspected. The app's displayed photos are
  bundled licensed JPEGs, including real photographs of the lake, flower park,
  station and Japanese bridge. Generic destination reuse is labeled.
- Public GitHub Pages deployment **verified on 5 November 2026** at
  [YangAtlas](https://nguyenhonggiang2407.github.io/YangAtlas/), application commit
  `6cdb956be85eb1d4018851d00f5da50bc0471429`. [CI41944144524](https://github.com/nguyenhonggiang2407/YangAtlas/actions/runs/41944144524)
  passed19 domain tests,10 browser workflows, asset integrity and publication on the
  exact commit, including the cross-year trip-cover correction.
- All26 public build resources returned HTTP200 and matched canonical Git blobs
  and SHA-256: source modules/styles,6JPEGs,6fonts and bundled license/provenance files.
- Independent live Chromium contexts at1440×1000 and390×844 loaded real photos and
  fonts without runtime/console/HTTP/request errors or horizontal overflow. Real UI
  edits survived reload; place search/category/add and actual JSON/ICS downloads
  passed, including the2030→2031 trip and event dates. Only isolated browser-local
  state was used, without backend writes or user-browser access.
- Full observations, resource hashes and screenshot timestamps are in
  [live evidence](evidence/live-verification.json); decodedCI log excerpts are in
  [CI evidence](evidence/ci-verification.json). Screenshots now come from the actual
  public deployment. This is one Chromium check, not a physical-phone, Firefox,
  WebKit, accessibility-certification or ongoing-uptime claim.

Photograph author/license/source links, unchanged file bytes and SHA-256 values
are in docs/MEDIA.md and LICENSES/photos/manifest.json. Self-hosted font provenance
and SIL OFL notices are under LICENSES/fonts. All app screenshots must be captured
from the running build rather than generated or assembled.
