# Blemmy v2.2 — Review Mode Integration
*Structured annotation layer with bot-addressable comment operations*

---

## What this patch adds

- **Review toggle** — a `✎` button in the left dock activates review mode. The CV shell gains hover states on annotatable elements and the overlay renders.
- **Comment indicators** — amber/red dots positioned over any annotated element. Click a dot to open the comment thread for that path. A count badge on the toggle button shows total open comments.
- **Review panel** — a right-side drawer listing all comments. Supports adding, replying, resolving, and deleting comments. Filter to a specific path by clicking any indicator or path chip.
- **Structured paths** — every annotatable element has a canonical address (`work[2].highlights[1]`, `basics.summary`, `style.sidebarColor`, etc.) which is what the bot receives as context.
- **Bot integration** — open comments are injected into the AI system prompt as structured tasks. The bot can resolve comments, add replies, and flag new issues via a ` ```review ` fenced block.
- **Click-to-annotate** — in review mode, annotatable elements show a cursor and hover state. Clicking an un-annotated element opens a new comment form pre-targeted to that element's path.

---

## Files in the zip

| File | Type | Purpose |
|---|---|---|
| `src/types/cv-review.ts` | **New** | `CVReview`, `ReviewComment`, `CommentOperation`, `ContentPath` types |
| `src/lib/cv-review.ts` | **New** | Comment CRUD, `applyCommentOps()`, path→DOM resolution, system prompt builder |
| `src/renderer/review-overlay.ts` | **New** | Indicator dots positioned over CV elements, hover highlight |
| `src/renderer/review-panel.ts` | **New** | Comment drawer UI — browse, thread, new comment form |
| `src/styles/review-mode.css` | **New** | All review mode CSS |
| `scripts/apply-v2.2-review-patch.mjs` | **New** | Patch script — modifies 6 existing files |

---

## Prerequisites

v2.1 must already be applied. The patch script checks for `extractStyleBlock` and `applyStylePatch` in `chat-panel.ts` — if those anchors are missing it will abort with a clear message.

---

## Integration steps

### Step 1 — Copy new files

All new files — nothing overwritten:

```
src/types/cv-review.ts              → src/types/cv-review.ts
src/lib/cv-review.ts                → src/lib/cv-review.ts
src/renderer/review-overlay.ts      → src/renderer/review-overlay.ts
src/renderer/review-panel.ts        → src/renderer/review-panel.ts
src/styles/review-mode.css          → src/styles/review-mode.css
scripts/apply-v2.2-review-patch.mjs → scripts/apply-v2.2-review-patch.mjs
```

### Step 2 — Run the patch script

```bash
node scripts/apply-v2.2-review-patch.mjs
```

Expected output:
```
Blemmy v2.2 review mode patch

  v src/types/cv.ts
  v src/lib/cv-chat.ts
  v src/lib/cv-chat-prompts.ts
  v src/renderer/ui-components.ts
  v src/renderer/chat-panel.ts
  v src/main.ts

Done. Run: npm run typecheck && npm run dev
```

### Step 3 — Verify

```bash
npm run typecheck
npm run dev
```

Click the `✎` button in the left dock. The CV shell should show hover states on work entries, education blocks, and field elements. Add a comment by clicking any element in review mode — a form appears pre-targeted to that element's path.

---

## What the patch script changes

**`src/types/cv.ts`**
Adds `import type { CVReview }` and a `review?: CVReview` optional field at the end of the `CVData` interface. Existing documents without a review field are unaffected — the field is absent, not null.

**`src/lib/cv-chat.ts`**
Appends `extractReviewBlock()` alongside the existing `extractJsonBlock()` and `extractStyleBlock()`. Same regex pattern, different fence language identifier (` ```review `).

**`src/lib/cv-chat-prompts.ts`**
Three additions: imports `CVReview` type and `buildReviewPromptSection` from `cv-review`; adds an optional `review?` parameter to `buildSystemPrompt()`; builds a `reviewSection` string from open comments and injects it into the return string before the style schema section. When no review is present (or no open comments) the section is empty and the prompt is unchanged.

**`src/renderer/ui-components.ts`**
Imports `initReviewPanel`, `initReviewOverlay`, `updateOverlay`, `CVReview`, `applyCommentOps`; mounts the review panel and overlay after `buildEditButton()`; wires `cv-layout-applied` to re-run `updateOverlay()` after every layout pass (so dots reposition correctly); registers `window.__blemmySyncReview__` and `window.__blemmyApplyReviewOps__` for bot-side sync.

**`src/renderer/chat-panel.ts`**
Adds `extractReviewBlock` import; adds `CommentOperation` and `applyCommentOps` imports; adds `applyReviewOps()` function that parses the review block, applies ops to `window.__CV_DATA__.review`, and calls `window.__blemmySyncReview__` to update the panel and overlay; threads `cv?.review` into the `buildSystemPrompt()` call; calls `applyReviewOps()` in both the normal-chat and generate-path streaming handlers alongside the existing style and json block handlers.

**`src/main.ts`**
One line: appends `import '@styles/review-mode.css'` after the existing CSS imports.

---

## Path reference

The path system is how comments are addressed. Use these patterns:

| Path | What it targets |
|---|---|
| `basics.summary` | The summary paragraph |
| `basics.name` | Name in masthead |
| `work[0]` | First work entry (entire block) |
| `work[0].highlights[2]` | Third bullet of first work entry |
| `education[1]` | Second education entry |
| `skills.programming[0]` | First programming skill tag |
| `languages[0]` | First language entry |
| `layout` | Layout decisions generally |
| `style.sidebarColor` | Sidebar colour decision |

Paths are stored as strings and displayed in the panel — they're also clickable to jump the overlay focus to that element.

---

## Bot usage examples

```
User: "Review my CV for a research role and flag any weaknesses"

Bot returns:
```review
[
  { "op": "flag", "path": "work[0].highlights[1]", "text": "Vague outcome — what was the research impact?" },
  { "op": "flag", "path": "basics.summary", "text": "Summary reads as generalist. For research, lead with methodology or publication." },
  { "op": "flag", "path": "work[2]", "text": "This role predates the research focus — consider hiding it for this application." }
]
```
```

```
User: "Address all of Jonas's comments"

Bot returns both a ```json content patch AND:
```review
[
  { "op": "resolve", "id": "abc123", "resolvedBy": "assistant" },
  { "op": "reply",   "id": "def456", "text": "Tightened to two lines with a quantified outcome." },
  { "op": "resolve", "id": "def456" }
]
```
```

Content and review ops can appear in the same response. All three block types — ` ```json `, ` ```style `, ` ```review ` — are parsed independently.

---

## Versioning

```bash
git add -A
git commit -m "feat: v2.2.0 — review mode

- CVReview annotation layer: ReviewComment, ContentPath, CommentOperation types
- Comment CRUD: add, resolve, reply, delete, flag
- Overlay: indicator dots (amber=open, red=flagged) with bounding-rect positioning
- Review panel: browse, thread, new-comment form, resolve/reply/delete actions
- Bot integration: open comments injected into system prompt as structured tasks
- Bot response: extractReviewBlock() + applyReviewOps() in chat pipeline
- Path system: work[N].highlights[M], basics.*, education[N], skills.*, layout, style.*
- CVData.review?: CVReview optional field (backwards compatible)"

git tag v2.2.0
git push && git push --tags
```
