# Layout Audit Report

## Reproducible Scenarios

- Baseline render (`initial`)
- Edit mode entered (`edit-mode-enabled`)
- Hide first work item (`hide-first-work`)
- Unhide same work item (`unhide-first-work`)
- Reorder roundtrip (`move-work-down`, `move-work-up`)
- Text change roundtrip (`summary-lengthen`, `summary-restore`)

Captured evidence:

- `docs/reports/layout-audit-trace.json`
- `docs/reports/layout-determinism-report.json`
- `docs/reports/layout-recalc-diagnostics.json`

## Findings

1. Determinism across repeated identical-state replays is stable:
   - `docs/reports/layout-determinism-report.json` reports `inconsistent: []`.
2. Hide -> unhide previously left residual default visibility state in data:
   - roundtrip did not always restore byte-equivalent data shape.
   - this could alter candidate ordering/selection under ties.
3. Candidate selection had no explicit tie-break path beyond combined score:
   - near-equal candidates could select differently based on tiny score drift.
4. Layout scheduling and persistence were hard to inspect in runtime:
   - there was no debug-gated trace of applyData/remount/filter/layout requests.

## Root-Cause Fixes Applied

- `src/renderer/cv-editor.ts`
  - Added `cleanupVisibility()` and invoked it on unhide/show actions.
  - Effect: hide -> unhide now restores minimal visibility state
    (removes empty default visibility object when no manual overrides remain).

- `src/lib/engine/layout-engine.ts`
  - Added deterministic sort tie-breakers for scored candidates:
    `combined -> heightScore -> affinityScore -> candidate.id`.
  - Added debug-gated audit logs for request/apply/candidate/winner lifecycle.

- `src/main.ts`
  - Added debug-gated audit logs for session load/save, mount, and applyData.

- `src/lib/cv-filter.ts`
  - Added debug-gated audit logs for resolved visibility merges.

- `src/lib/engine/layout-audit.ts`
  - New shared debug-gated instrumentation utility:
    - enable with query `?debug-layout=1` or `localStorage.cv-debug-layout=1`.
    - includes stable hash helpers for state/candidate snapshots.

## Regression Coverage Added

- `scripts/audit-layout-edit-sequences.mjs`
  - deterministic scenario matrix trace generator.
  - outputs `docs/layout-audit-trace.json`.

- `scripts/test-layout-determinism.mjs`
  - replays captured states 3x each and verifies stable winner metadata.
  - outputs `docs/reports/layout-determinism-report.json`.

- `package.json` scripts:
  - `test:layout-audit`
  - `test:layout-determinism`
  - `test:unit` now uses full CPU worker parallelization.

## Before/After Evidence

- Before: hide/unhide could retain default visibility scaffolding in saved data.
- After: unhide/show cleanup removes default visibility when logically empty.
- Before: scored candidate ties relied only on combined score.
- After: deterministic multi-key tie-break ordering ensures stable winner pick.
- Determinism replay after fixes: no inconsistent winner metadata across all
  audited steps (`docs/reports/layout-determinism-report.json`).

## Residual Risks / Follow-ups

- `test-layout-recalc` intentionally includes a `prefer-2` step that can switch
  to two-page even with modest content; that is preference-driven behavior.
- The edit-sequence audit uses one base profile and a fixed set of actions.
  Add heavier content fixtures (already available in `evaluate-layout-engine`)
  if you want broader stress coverage.
- Keep debug instrumentation gated and remove or reduce once this audit cycle is
  fully accepted.

