# Phase 3: Review Before Apply (assistant JSON)

**Status (2026):** Implemented for assistant-returned **document JSON** (not style/review blocks).

Goal: optional staged flow so AI suggestions can be included or excluded **before** mutating the live document.

## Scope (implemented)

- User setting: **Auto-apply** vs **Review first** — Layout preferences panel → **Assistant** row (`blemmy-assistant-apply-mode` in `localStorage`; default **Auto-apply**).
- In **Review first**, assistant JSON is parsed and validated, a **leaf diff** is computed (`computeLeafDiffBetweenDocuments`), and the UI shows grouped paths with checkboxes (include / exclude).
- **Apply included** merges selected `afterValue`s onto a **clone of the document at staging time**, validates once, then **`recordDocumentApplyHistory` + `__blemmyRemountDocument__`** — one undo transaction.
- **Include all** / **Exclude all** / **Discard**; pending proposal is cleared when the active document changes (`blemmy-active-document-changed`).
- Streaming and “Apply” / “Review changes” buttons on JSON blocks respect the same mode; status copy distinguishes auto vs review.

## UX requirements (met)

- Clear chat status when review mode stages a proposal.
- No second auto-apply when Review first is on (staging replaces immediate remount).
- Global undo/redo unchanged after apply.
- Recent-changes panel continues to reflect accepted applies.

## Technical notes (current code paths)

- **Live document:** `window.__blemmyDocument__`, type id `window.__blemmyDocumentType__` (see `active-document-runtime.ts`).
- **Apply:** `__blemmyRemountDocument__(data, documentType)` from `main.ts`.
- **Staging:** `parseAssistantJsonPayload` in `chat-panel.ts` (merge + coerce CV + `validateDocumentByType` + portrait carry-over); diff vs `cloneDocumentData(current)`; merge via `buildDocumentFromLeafSelection` in `assistant-pending-merge.ts`.
- Reuse **leaf diff** shape: `LeafChange` (`path`, `before`, `after`, `beforeValue`, `afterValue`, `state`) from `blemmy-document-edit-history.ts`.

## Non-goals (unchanged)

- Perfect semantic array matching or move detection.
- Long-term persistence of pending proposals across reload.
- Multi-user merge or conflict handling.

## Original milestones → outcome

1. Mode toggle and pending model — **done** (`assistant-apply-preferences.ts`, chat panel state).
2. Review UI with accept/reject — **done** (checkbox per leaf, grouped by top-level key).
3. One-transaction apply — **done** (`Apply included`).
4. Tests — **partial** (`assistant-pending-merge.test.ts`); e2e / manual QA checklist still optional.

## Follow-ups (optional)

- Cap / virtualise very large diffs beyond the current leaf limit (120).
- E2E: Review first → toggle fields → Apply included → undo.
