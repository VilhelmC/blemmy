# Phase 3 Proposal: Review Before Apply

Goal: add an optional staged review flow so AI suggestions can be accepted
or rejected before mutating the CV data.

## Scope

- Add a user setting: `Auto-apply` vs `Review before apply`.
- Keep current behavior as default (`Auto-apply`) for speed.
- In review mode, parse AI JSON and compute a change set, but do not mount.
- Show proposed changes in a review panel with:
  - section grouping (`basics`, `work`, `education`, etc.)
  - before/after preview per item
  - item-level `Accept` / `Reject`
  - `Accept all` / `Reject all`
- After acceptance, apply selected changes as one history transaction.

## UX Requirements

- Clear status in chat: "Proposed changes ready for review."
- No duplicate apply controls when review mode is active.
- Preserve keyboard shortcuts and existing global undo/redo behavior.
- Keep current recent-changes panel for accepted changes.

## Technical Notes

- Reuse existing leaf diff model (`path`, `before`, `after`).
- Add "pending changes" state separate from live `window.__CV_DATA__`.
- Apply accepted changes by patching a cloned CV object and calling the
  existing `applyData(..., true)` path to preserve history consistency.
- Limit pending list size and render only visible rows for performance.

## Non-goals (Phase 3)

- Perfect semantic array matching or move detection.
- Long-term persistence of pending changes across reload.
- Multi-user merge or conflict handling.

## Suggested Milestones

1. Add mode toggle and pending-change data model.
2. Render review panel with accept/reject controls.
3. Wire accept/reject actions to one-transaction apply.
4. Add smoke tests and manual QA checklist.
