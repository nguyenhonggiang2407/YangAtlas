# Verification

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
