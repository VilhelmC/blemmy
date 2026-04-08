# Changelog

All notable changes to Blemmy are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The public contract is the `CVData` JSON schema (`src/types/cv.ts`). A change
that breaks an existing `cv-content.json` file is a major version bump.

---

## [Unreleased]

### Added

- **Assistant “review before apply”** — Layout preferences include **Assistant → Auto-apply / Review first**. In Review first mode, assistant JSON is staged as a leaf diff; include or exclude fields, then **Apply included** as a single undo step (`#blemmy-chat-pending-apply`). See `docs/phase-3-change-review-plan.md`.
- **`assistant-apply-preferences`** — `blemmy-assistant-apply-mode` in `localStorage` and `blemmy-assistant-apply-mode-changed` on `window`.
- **`computeLeafDiffBetweenDocuments`** — exported from `blemmy-document-edit-history.ts` for generic JSON diffs.
- **`assistant-pending-merge`** — merges accepted leaf paths onto a base snapshot with validation.

### Changed

- **Planning docs** — README roadmap checkboxes updated for shipped items; Phase 3 doc technical notes aligned with unified active document (`__blemmyDocument__`, `__blemmyRemountDocument__`).

---

## [2.0.1] — 2026-03-25

First public release under the Blemmy name. Portfolio publication cleanup —
no functional changes.

### Fixed
- `.gitignore`: removed stray `EOF` heredoc artifact; added `src/data/cv-*.json`
  exclusion with `!cv-demo.json` whitelist; added `public/*.pdf/jpg/png`;
  added `docs/reports/` for generated diagnostic files
- `docs/README.md`: demoted from misplaced project README to internal dev notes
  index
- `src/lib/cv-chat-prompts.ts`: `isDefaultCvData()` sentinel updated to match
  demo data name (`'Alex Meridian'`)

### Added
- `README.md` (root): complete rewrite for the v2 Vite/TypeScript SPA
  architecture — layout engine pipeline, feature list, test strategy, design
  token table, architecture decisions
- Project renamed to **Blemmy** — named after the Blemmyes, the mythological
  headless people of classical antiquity
- `src/data/cv-demo.json`: fictional demo persona (Alex Meridian) replacing
  real personal data as the committed example
- `LICENSE` (root): MIT licence covering the application layer
- `src/lib/engine/LICENSE`: AGPL v3 licence scoped to layout engine source
  files, with commercial licence option
- `src/lib/engine/package.json`: `@blemmy/engine` boundary marker —
  pre-extraction placeholder establishing the engine as a separately-licenced
  logical package ahead of the v3.0 workspace extraction
- `CHANGELOG.md`: version history from v1.0.0
- `docs/reports/`: directory for generated layout diagnostic reports
  (git-ignored contents)
- `.github/workflows/deploy.yml`: GitHub Actions pipeline — typecheck, unit
  tests, Vite build, GitHub Pages deployment

### Removed
- Diagnostic JSONs from `docs/` root — moved to `docs/reports/` (git-ignored)
- Personal assets removed from version control: PDFs, portrait image, real
  CV data files

---

## [2.0.0] — 2026-01-10

Major architectural rewrite from the v1 Astro static-site approach to a
fully client-side Vite + TypeScript SPA.

### Changed (breaking)
- **Framework**: Astro → Vite + TypeScript. No Astro components, no build-time
  rendering, no Tailwind CSS. All document DOM is built client-side from `CVData`
- **Layout**: static template → 8-stage runtime layout engine with constrained
  search over layout candidates
- **Data loading**: build-time JSON import → runtime JSON load with validation

### Added
- `src/lib/engine/layout-engine.ts`: 8-stage layout pipeline
- `src/lib/engine/layout-candidate.ts`: constraint-driven candidate generation and
  scoring
- `src/lib/engine/layout-align.ts`: cross-column landmark snapping
- `src/lib/engine/layout-slack.ts`: flex gap absorption
- `src/lib/engine/layout-profile.ts`: section width-sensitivity measurement
- `src/lib/cv-chat.ts`: provider-agnostic streaming LLM client (Anthropic,
  Gemini)
- `src/lib/cv-chat-prompts.ts`: layout-aware and schema-aware system prompt
  builder
- `src/lib/cv-cloud.ts`: Supabase auth and document storage
- `src/lib/cv-sync.ts`: debounced auto-save with conflict guard
- `src/lib/cv-filter.ts`: tag-based content filtering
- `src/lib/cv-loader.ts`: JSON schema validation with structured error messages
- Full renderer layer: `cv-renderer.ts`, `cv-editor.ts`, `chat-panel.ts`,
  `document-panel.ts`, `auth-panel.ts`
- Layout test suite: determinism, recalculation stability, edit-sequence
  regression, quality evaluation
- GDPR documentation and retention cleanup script

---

## [1.0.0] — 2025-06-01

Initial release (project then named Headless CV).

Astro + Tailwind CSS static site. CV content in a single JSON file. Build-time
rendering with `@media print` PDF export via Puppeteer. No cloud, no AI, no
runtime layout decisions.
