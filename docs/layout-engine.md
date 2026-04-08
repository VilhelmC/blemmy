# CV layout engine

**Module:** `src/lib/engine/layout-engine.ts`  
**Entry:** `initLayoutEngine()` (imported in `src/main.ts` as `initCvLayoutEngine`) after `renderCV()`.

Document DOM ids and classes use the **`blemmy-*`** vocabulary (card, shell, pages, sidebars, mains, masthead, movable sections). The root card is **`#blemmy-card`** and receives **`data-blemmy-layout-*`** attributes for diagnostics and tooling.

## Pipeline

1. **Reset** — `fullReset`: restore masthead to full layout, move movable sections from `#blemmy-rebalance-*` back into **`#blemmy-sidebar-2`**, clear footer column layouts on **`#blemmy-page-1-body-footer`** / **`#blemmy-page-2-body-footer`**, strip density / single-page classes from **`#blemmy-card`**, show **`#blemmy-page-2`**.
2. **Target** — If not print preview / print media → disposition `web-idle`, no merge.
3. **One page** — (a) **`merge squeeze` `0…2` × `density` `0…3`**. (b) **`#blemmy-page-1-masthead` strip trials** (default **`full`**: profile + **`#blemmy-masthead-right`** in masthead; then **`compact`**, **`minimal`**, **`strip`**, etc.) — each followed by a **full squeeze×density** pass. (c) **`#blemmy-page-1-body-footer`** offloads **`lang` / `int`** when needed. **Squeeze** toggles **`.cv-merge-squeeze-1`** / **`.cv-merge-squeeze-2`** on **`#blemmy-card`** (see `global.css`). Then **merge**, **`blemmy-fill-1…3`**. Card classes: **`blemmy-single-page`**, **`blemmy-density-*`**, **`blemmy-fill-*`**. **Body footers** use a **multi-column grid** when several blocks sit in the footer (`auto-fit` columns).
4. **Two pages** — Unmerge, record merged-fail metrics. **Heavy** vs **underfill** (`merged grid < 1.5 × A4` height).
5. **Disposition search** — For each candidate, apply DOM + optional sidebar width (e.g. **`data-blemmy-layout-sidebar-mm`** on the card and **`--blemmy-sidebar-width-override`** / zone mm vars), add **`blemmy-layout-measure-intrinsic`** on page 2 so the sheet and grid use **intrinsic height** and **`align-items: start`**. Page 2 uses **two grid rows** (`auto auto` while measuring); **`#blemmy-sidebar-2` spans both rows** so the dark column is full sheet height while **`#blemmy-page-2-body-footer`** stays column 2 only. **Score** uses **summed visible child heights + flex gap** per column: sidebar vs **main column** (main stack + **`#blemmy-page-2-body-footer`** + row-gap). Console logs a **full candidate table** each run.
6. **Apply winner** — Re-apply best candidate; set **`data-blemmy-layout-disposition`**, **`data-blemmy-layout-pages`**, winner id, candidate/scored counts, timing, status line (`#blemmy-layout-status`), console group.
7. **Vertical slack** — After fill / two-page DOM is final, **`columnSlackBelowDirectDivBlocksPx`** (`src/lib/engine/layout-slack.ts`): same rule as **Visual audit**. The last **`.blemmy-sidebar-tail-spacer`** node is **excluded** from “content bottom” slack math (sentinel + DOM order); **visible** bottom inset in print is **`padding-bottom`** on **`#blemmy-sidebar-1`** / **`#blemmy-sidebar-2`** (`--print-sidebar-column-tail`), because **`overflow: hidden`** on the flex column clips the last flex item when the stack is taller than the cell. Absorption is **iterative** (re-measure after `requestAnimationFrame`, up to 14 rounds): each step adds `slack / (visibleDirectFlexItemCount − 1)` (outer) or divides by inner `childElementCount − 1`, cumulative on the column’s custom properties — a single pass left most fr-row slack because one gap bump does not close the gap in one layout pass. **Single-page merge:** intrinsic-height trim scales **main** slack vars first, then **sidebar** — columns are adjusted **independently** until the merged grid fits `MAX_SINGLE_PAGE_PX`; only that **shared height budget** links them. **`web-idle`** clears column vars with fill. **Print:** main uses its own padding; sidebar tail is CSS padding + spacer sentinel, not the engine.

Fires `window` event **`blemmy-layout-applied`** for diagnostics (after slack).

## Principled regions

| Region | Role |
|--------|------|
| **Sidebar** | Page 1: education (+ portrait in **`#blemmy-p1-portrait-cell`**); optional relocated identity when masthead is stripped. Skills, languages, interests on page 2. |
| **Main column** | Narrative blocks (experience, research placeholder). |
| **Main-column footer** (`#blemmy-page-2-body-footer`) | Optional **supplementary** blocks moved only under **underfill** scoring: short, repeatable sections (languages, interests) so they stay **paper-colored** and **main-width**, not full-bleed. |
| **Future header/footer bands** | May span **main only** or full sheet; full sheet is reserved for print crop marks / page labels, not sidebar-colored strips. |

## Dispositions (`data-blemmy-layout-disposition`)

| ID | Meaning |
|----|---------|
| `web-idle` | Wide web layout; engine idle |
| `single-page` | Merged; density + optional fill |
| `two-page·p2-62` | Default 62 mm sidebar on **both** pages |
| `two-page·p2-54` | 54 mm sidebar both pages, no body-footer moves |
| `two-page·footer-int·54` | Interests in `#blemmy-page-2-body-footer` |
| `two-page·footer-lang-int·54` | Languages + interests in body footer |
| `two-page·footer-lang-int·48` | Same body-footer stack, 48 mm sidebar both pages |

**Heavy** two-page runs only the first two rows (no footer moves). **Underfill** runs the full table so body-footer strategies compete on score.

## Print preview vs PDF

Puppeteer uses **`@media print`** only (`print.css` + **`blemmy-print-parity.css`**). In-app print preview uses **`@media screen`** + **`blemmy-print-surface.css`** plus **`blemmy-print-parity.css`**. **`html.blemmy-print-surface`** uses **`font-size: 10pt`** like **`print.css`** on `html, body` — document typography is **`rem`-based**, so matching the root avoids taller masthead in preview than in PDF (misaligned portrait band / masthead slack).

## Layout diagnostics vs this engine

**Debug Layout** (see `src/renderer/ui-components.ts`) draws overlays using the same **`columnSlackBelowDirectDivBlocksPx`** idea from **`src/lib/engine/layout-slack.ts`** (slack below the lowest visible **direct `div`** in **`.blemmy-sidebar`** / **`.blemmy-main`** / footer). **`initLayoutEngine()` uses that module** for vertical slack into `gap` / inner `row-gap`. Other diagnostics (sheet tail, grid short, large sibling gaps) are still **not** engine inputs. Two-page disposition still uses **`sumFlexColumnContentPx`** / **`scoreP2Balance`** on page 2 only.

**Objectives today**

| Goal | Where |
|------|--------|
| Fit merged content in one A4 band | Merge + density + fill |
| Balance page-2 sidebar vs main **content sums** | `pickBestTwoPageDisposition` |
| Move languages/interests under main when **underfill** | Footer slots + same scoring |

**Slack vs diagnostics:** Engine now **injects** measured column slack into flex `gap` (see step 7). Debug overlays may still show unused sheet margin below the grid; that is separate from intra-column spacing.

**Future:** add a painted-whitespace term to `scoreP2Balance`, or distribute slack into non-gap spacing — new scope.

## Extending

- Add a `TwoPageCandidate` in `CANDIDATES_UNDERFILL` / `CANDIDATES_HEAVY`.
- Implement `footer: ['skills']` (or new slots) in `applyFooterSlots` + paper-column styling under **`#blemmy-page-2-body-footer`**.
- Tune `scoreP2Balance` weights to prefer different aesthetics.
- Optional: second-phase scoring using painted rects for truer “whitespace” cost.
