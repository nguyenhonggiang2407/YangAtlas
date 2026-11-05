# YangAtlas update UX review

Review date: 5 November 2026. Scope: read-only review of `src/offline.js`, `public/service-worker.js`, and the app's update/save-protection handlers. The public 32-file release `6b9f6cefa81f062b7b09493e496b2e0a8ec9b3e4` remains unchanged by this review. The existing 40 unit/17 browser checks and 10 public verification checks were not rerun.

**Result:** one confirmed reload race, subsequently fixed by root and verified in the local candidate. After coordination, this agent added four focused regression tests to `tests/offline.test.js`; all four passed. Two real-browser delayed-update scenarios also passed on the fixed local 32-file build `49cb10771f00fa8fec68e244`. This is not a claim that the local fix has already been published.

## Confirmed finding: update completion can discard newly opened forms or protected in-memory edits

**Priority: P2 — data-loss race in the initiating tab.** `src/app.js` checks `storageError || protectStored` when the visitor first clicks **Cập nhật ứng dụng**, but `awaitOfflineUpdate()` later calls `location.reload()` unconditionally when `applyUpdate()` resolves `true`. The visitor can continue using the interface while waiting. Neither a newly opened dialog nor a storage conflict arriving during that interval is checked at completion.

This is a gap in the caller's reload decision, not a claim that `offline.js` silently reloads tabs: the module itself does not reload or write localStorage.

### Local real-browser reproduction

- Served the actual canonical 32-file `6b9f6ce` distribution from an in-memory HTTP server at a random **127.0.0.1** port under `/YangAtlas/`.
- Used a fresh Chromium browser and isolated contexts; each scenario opened two tabs in the same context. Personal trip/activity/checklist data was entered through the actual app UI.
- Offered a second worker by changing its release ID **in the server's response buffer only**. Its update message waited seven seconds **before calling `skipWaiting()`**. This is a controlled lifecycle timing stimulus; production source files and artifacts were not edited. It does not claim that normal updates always take seven seconds.
- The delay exposes the asynchronous interval that the app already allows (the API has a 15-second activation timeout). Asset responses and application code stayed identical to the actual release; the test did not substitute saved workspace data or app handlers.
- All local browser contexts and the local server were closed after the two scenarios. No public request, provider resource, repository write, deployment, or backend mutation was needed.

**Scenario A: a new form appears after accepting the update.**

1. Tab B opened an activity form and entered `Bản nháp ở tab B` without submitting it.
2. Tab A accepted the waiting update. Its click returned after **15 ms**.
3. Tab A opened an activity form and entered `Bản nháp mở sau khi chọn cập nhật` after **62 ms**. The page's `performance.timeOrigin` was still unchanged, proving that the draft existed before the reload.
4. After the worker took control, tab A reloaded and its activity dialog count became **0**: the draft was lost.
5. Tab B's `performance.timeOrigin` remained unchanged and its draft text was still present. The unrelated tab was **not** silently reloaded.

**Scenario B: cross-tab save protection arrives after accepting the update.**

1. Tab A accepted the waiting update.
2. Tab B saved a checklist entry `Thay đổi mới lưu ở tab B`.
3. Tab A displayed the actual warning: `Dữ liệu đã đổi ở tab khác. Bản sửa ở tab này vẫn còn; xuất JSON trước khi tải lại.`
4. Tab A added `Bản sửa chưa lưu ở tab A`. After **594 ms**, it was visible in the timeline while the page was still the original document. Save protection correctly kept this edit in memory; persisted activities remained **0**.
5. The pending update nevertheless reloaded tab A. Its activity cards became **[]**, discarding the protected in-memory edit before the visitor could export it. Tab B's saved checklist entry remained intact, and its newer localStorage was not overwritten.

### Minimal correction and targeted regression proposal

Immediately before the post-update `location.reload()`, recheck `protectStored`, `storageError`, and `document.querySelector('dialog[open]')`. If any is present, keep the current document and its data/form, and show a clear instruction to save the form or export a backup before reopening. The worker has already activated, so a reload can remain a separate, deliberate user action. Blocking edits during activation is an alternative for form input, but the final storage-conflict check is still required because another tab can change data.

Proposed narrow tests in `tests/offline.test.js`, using the actual `awaitOfflineUpdate()` function from app source and a deferred `applyUpdate()` promise:

1. Clean document, no new conflict: resolve `true` and reload once.
2. A dialog opens while the promise is pending: resolve `true`, preserve the document/form, no reload.
3. A storage conflict/protected edit arrives while pending: resolve `true`, preserve in-memory data, no reload.

Test edits required coordination with root and had not been made when this finding was first reported. Root owns the application fix.

## Fix verification after coordination

Root changed the actual `awaitOfflineUpdate()` handler to recheck the current form/storage-protection state when the promise resolves. When unsafe, it keeps the current document and instructs the visitor to save/export before deliberately reopening.

Four newly authorized tests evaluate the **actual function from `src/app.js`** in a small deferred-activation harness; they do not copy its guard conditions into a replacement implementation. Executed with:

```text
node --test --test-name-pattern='real app update policy' tests/offline.test.js
```

**4 tests / 4 passed:** clean document reloads exactly once after activation; a dialog opened while pending is preserved; a protected in-memory edit arriving while pending is preserved; a storage failure appearing while pending prevents reload. The previous baseline suite was not repeated by this agent.

The two browser scenarios were then repeated against the **actual newly built app** (`work/YangAtlas/dist`, 32 files, local build `49cb10771f00fa8fec68e244`, Chromium 156.0.8078.4), with the same RAM-only seven-second delay before the candidate worker's `skipWaiting()`:

| Scenario | Actual result after one observed `controllerchange` |
| --- | --- |
| New form opened during activation | Draft entered **70 ms** after accepting update; tab A did **not** reload and its draft remained. Tab B also did not reload and its existing draft remained. |
| Storage conflict and protected in-memory edit during activation | Edit entered **575 ms** after accepting update; tab A did **not** reload and its timeline still contained the protected activity. Tab B's newer persisted checklist remained intact; persisted activity count stayed **0** as intended by save protection. A **real browser JSON download** from A still contained the protected activity, proving it was available for backup. |

Both isolated contexts, the browser, and the loopback-only in-memory server were closed. No browser user profile, public service, live source, deployment, provider resource or Git state was changed by these checks. Only the agreed regression test file and this review report were edited by this agent.

## Other observations within this bounded review

- **Two-tab non-disruption works:** the real-browser update left the non-initiating tab's open form and draft intact. `controllerchange` only updates status/button state there.
- **Newer persisted data is protected:** `commit()` and the `storage` listener prevented tab A from overwriting tab B's newer saved data in the reproduced conflict. The confirmed loss concerns the later automatic reload of A's memory/form.
- **Normal readiness has a sound installation order:** the worker awaits integrity-checked `cache.addAll()` before activation; the module uses the activated registration/controller to announce readiness. The existing public proof already checked the actual 31 cached resources and offline reopen/edit/reload. No additional readiness failure was observed in this review. External browser/site-storage removal is outside that existing readiness guarantee and was not presented as a newly verified defect.
- **Scope and resource isolation remain appropriate by source review:** versioned cache cleanup is limited to this application's path prefix; only listed same-origin GET resources are handled. The worker never invokes `skipWaiting()` during installation and only accepts the explicit app-scoped update message.

No authentication, data schema, source media/license, application/worker source file, Git history, or public deployment was changed by this reviewing agent. Root's application fix was reviewed and tested as described above.
