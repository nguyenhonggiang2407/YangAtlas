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
- GitHub/Sites publication is pending; final observed deployment results and exact
  commits will be recorded after they succeed.

Photograph author/license/source links, unchanged file bytes and SHA-256 values
are in docs/MEDIA.md and LICENSES/photos/manifest.json. Self-hosted font provenance
and SIL OFL notices are under LICENSES/fonts. All app screenshots must be captured
from the running build rather than generated or assembled.
