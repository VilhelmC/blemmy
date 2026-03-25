# Print preview vs PDF — why two paths, where truth lives

## Why CSS forces two “modes”

1. **PDF (Puppeteer)** runs with **`emulateMediaType('print')`**. Only rules inside **`@media print { … }`** apply from `print.css`. The live page is not “printing”; the engine is simulating print media to match paper output.

2. **Print preview in the browser** is still **normal screen rendering** (`matchMedia('print')` is false). You cannot put the whole CV under `@media print` and see it on screen unless you open the print dialog or use an iframe with print media (heavy-handed).

So historically the project added **`cv-print-surface.css`**: **`@media screen`** rules scoped with **`html.cv-print-surface .cv-shell.cv-print-preview`** to **imitate** print on screen. That duplicated a large block of what `print.css` already said for `@media print`.

There is **no single CSS media query** that means “print **or** print-preview shell” in plain CSS. Duplication or a **build step** is required unless you change how PDF is generated (e.g. Puppeteer on **screen** media + same classes as preview — then you must still supply `@page` / PDF-only concerns somewhere).

## What acts as “source of truth” today

| Concern | Where to edit |
|--------|----------------|
| Root **`rem` base** (preview must match PDF) | `print.css` → `html, body` in `@media print`; **`cv-print-surface.css`** → **`html.cv-print-surface`**, **`body`** (same **10pt** / line-height / font-family) |
| Masthead band, portrait column, subgrid band | **`global.css`** + **`cv-print-parity.css`** (both **`@media print`** and **`@media screen`** preview prefix) |
| A4 shell, `@page`, hide UI, mm padding, print-only tweaks | **`print.css`** |
| Sidebar-only **bottom tail** (`padding-bottom` on `#cv-sidebar-*` + zero-height `.cv-sidebar-tail-spacer` sentinel; `--print-sidebar-column-tail`) | **`global.css`** token + **`print.css`** + **`cv-print-surface.css`** |
| Screen-only imitation of the above | **`cv-print-surface.css`** (should stay in sync with `print.css` where they overlap) |

**`cv-print-parity.css`** is the intentional **dual-entry** file: one block for print, one for preview, **same declarations**, so masthead/portrait parity does not depend on remembering two files.

## Why not literally one file for everything?

- **Selectors differ**: print uses `.cv-page { height: 297mm }`; preview needs `html.cv-print-surface .cv-shell.cv-print-preview .cv-page { … }`.
- **Some rules are print-only** (`@page`, `print-color-adjust`) or **screen-only** (preview chrome).
- **True single source** for the duplicated block would be a **build step** (e.g. PostCSS) that emits the same declarations twice with different selector prefixes, or a small script that generates `cv-print-surface` from a shared token file.

## Practical rule for contributors

1. If a rule must match **PDF and print preview** → put it in **`cv-print-parity.css`** (both sections) **or** add to **`print.css`** and **mirror** in **`cv-print-surface.css`** in the same commit.
2. If it is **print-only** → **`print.css`** only.
3. If it is **preview-only** → **`cv-print-surface.css`** only (rare).

See also **`docs/cv-layout-engine.md`** (Puppeteer vs preview).
