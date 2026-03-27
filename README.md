# Blemmy

**A content-first document system with a precision layout engine, cloud sync, and an AI assistant.**

Edit one JSON file. The layout engine figures out the rest — one or two pages, sidebar width, section placement — and produces a pixel-accurate PDF and a live web view from the same source.

Built as a portfolio project and practical tool. The engineering is the point.

Live site: [blemmy.dev](https://blemmy.dev)

> The name comes from the Blemmyes — a mythological headless people described by Herodotus and Pliny, whose faces were mounted on their chests. A creature for whom headlessness is the natural state, not a surgical act. The right analogy for headless architecture.

---

## What this is

Most CV tools couple content to layout. Change a job title and you're fighting with text boxes. Change the design and you're re-entering all your data. Blemmy separates them completely:

```
src/data/cv-demo.json     ← The only file you edit for content
src/lib/engine/           ← Decides how to lay it out
src/styles/global.css     ← Design tokens — change once, PDF follows
```

The JSON is the single source of truth. Every render reads from it. The layout engine searches the candidate space to find the best fit for the current content — automatically.

---

## Architecture

This is a **Vite + TypeScript SPA** with no framework. The layout engine runs client-side in the browser; the same page that renders the web view also renders the PDF (captured by Puppeteer via `@media print`).

### Layout engine — 8-stage pipeline

The core of the project. Given a rendered document DOM, the engine runs a constrained search to find the optimal layout configuration:

```
1. PROFILE    Measure width-sensitivity of each section
2. GENERATE   Produce constraint-valid layout candidates
3. SEARCH     Score each candidate (height balance + preference affinity)
4. CLUSTER    Group results into perceptually distinct peaks
5. SIDEBAR    Binary-search the winning sidebar width (mm precision)
6. FILL       Step through fill levels within the A4 page budget
7. SLACK      Absorb remaining column height into flex gaps
8. ALIGNMENT  Cross-column landmark snapping + safe-zone guard
```

**What it decides automatically:**
- One page or two, and where to split work entries
- Sidebar width (binary search in mm)
- Masthead mode (4 variants depending on space)
- Section placement (skills/languages/interests: sidebar vs. footer vs. page 2)
- Density and fill tiers within the page budget

All decisions are written as CSS custom properties. The DOM is never reflowed from scratch between candidates — the engine mutates properties and re-measures.

See [`docs/cv-layout-engine.md`](docs/cv-layout-engine.md) for the full technical specification.

### Project structure

```
blemmy/
├── index.html                          # Entry point — fonts, dark mode script
├── src/
│   ├── main.ts                         # App bootstrap
│   ├── types/
│   │   └── cv.ts                       # TypeScript interfaces for cv-demo.json
│   ├── data/
│   │   └── cv-demo.json                # ← Demo content (edit this, or load your own)
│   ├── lib/
│   │   ├── engine/                     # @blemmy/engine — AGPL v3
│   │   │   ├── LICENSE
│   │   │   ├── package.json
│   │   │   ├── cv-layout-engine.ts     # 8-stage layout pipeline (1,300 lines)
│   │   │   ├── cv-candidate.ts         # Candidate generation + scoring
│   │   │   ├── cv-profile.ts           # Section width-sensitivity measurement
│   │   │   ├── cv-align.ts             # Cross-column alignment snapping
│   │   │   ├── cv-column-slack.ts      # Flex gap absorption
│   │   │   ├── cv-layout-snapshot.ts   # Serialisable layout state capture
│   │   │   └── layout-audit.ts         # Edit-sequence audit log
│   │   ├── cv-chat.ts                  # Multi-provider LLM client (streaming)
│   │   ├── cv-chat-prompts.ts          # System prompt + schema context builder
│   │   ├── cv-cloud.ts                 # Supabase auth + document storage
│   │   ├── cv-sync.ts                  # Auto-save with debounce + conflict guard
│   │   ├── cv-filter.ts                # Tag-based content filtering
│   │   ├── cv-loader.ts                # JSON validation + import
│   │   ├── cv-prefs.ts                 # Layout preference state + events
│   │   └── share-link-url.ts           # Share link token handling
│   ├── renderer/
│   │   ├── cv-renderer.ts              # Builds full document DOM from CVData
│   │   ├── cv-editor.ts                # Sidebar UI — preferences, filters, tools
│   │   ├── chat-panel.ts               # AI assistant panel + response parser
│   │   ├── document-panel.ts           # Cloud document management UI
│   │   ├── auth-panel.ts               # Auth flow (magic link, OAuth)
│   │   └── ui-components.ts            # Shared DOM helpers
│   └── styles/
│       ├── global.css                  # Design tokens + all layout (screen + print)
│       ├── print.css                   # Minimal print-only layer (@page, A4 shell)
│       ├── cv-print-surface.css        # Screen mirror of print surface for preview
│       └── cv-print-parity.css         # Rules shared between print and preview
├── scripts/
│   ├── build-cv-pdf.mjs                # Puppeteer HTML→PDF capture
│   ├── evaluate-layout-engine.mjs      # Layout quality eval across test cases
│   ├── test-layout-determinism.mjs     # Property test: same input → same output
│   ├── test-layout-recalc.mjs          # Recalculation stability under edits
│   ├── audit-layout-edit-sequences.mjs # Sequential edit regression suite
│   └── run-retention-cleanup.mjs       # GDPR retention enforcement script
└── docs/
    ├── cv-layout-engine.md             # Layout engine technical specification
    ├── cv-print-single-source.md       # Print/preview CSS architecture
    ├── supabase-cloud-schema.sql       # Full database schema
    ├── gdpr-data-inventory.md          # GDPR data mapping
    ├── gdpr-dsar-runbook.md            # Data subject access request runbook
    └── privacy-policy.md              # Privacy policy template
```

---

## Features

### Content authoring
- **Single JSON source** — all document content in one file, all fields typed
- **Tag-based filtering** — tag work/education entries; filter to a target role without deleting content
- **Visibility controls** — hide individual entries or whole sections without removing them from the JSON
- **Import** — upload a `.docx`, `.txt`, or paste text; the AI generates a complete JSON

### Layout engine
- **Automatic layout search** — finds the best configuration for the current content length
- **Preference controls** — density, fill level, sidebar section order, masthead mode
- **Multiple alternatives** — when the search finds distinct layout peaks, offers a choice
- **Debug overlay** — `?debug-layout=1` shows column slack, grid shortfall, and alignment gaps visually

### AI assistant
- **Provider-agnostic** — works with Anthropic (Claude) and Google (Gemini); model is configurable
- **Layout-aware** — system prompt includes the current layout state (pages, disposition, near-overflow)
- **Schema-aware** — the AI understands the full JSON structure and returns valid patches
- **Generate from scratch** — upload background material, get a complete document JSON

### Cloud (optional — requires Supabase)
- **Auth** — magic link, GitHub OAuth, Google OAuth
- **Document storage** — multiple documents per account, named and versioned
- **Auto-save** — debounced sync with conflict guard; visual sync indicator
- **Share links** — revocable, expiring read-only links per document
- **Version history** — load any previous version of a document

### GDPR
- Personal data fields documented in `docs/gdpr-data-inventory.md`
- Row-level security on all user data tables
- Share access event logging
- Retention cleanup script (`npm run gdpr:retention-cleanup`)
- DSAR runbook in `docs/gdpr-dsar-runbook.md`

---

## Setup

**Requirements:** Node.js 20+

```bash
git clone https://github.com/VilhelmC/blemmy.git
cd blemmy
npm install
npm run dev
# → http://localhost:5923
```

The app works fully without cloud configuration. Load `src/data/cv-demo.json` as a starting point, or use the AI assistant to generate from your own background material.

### Cloud setup (optional)

1. Create a [Supabase](https://supabase.com) project
2. Run `docs/supabase-cloud-schema.sql` in the SQL editor
3. Enable Email (magic link), GitHub, and Google providers under Authentication → Providers
4. Copy `.env.example` to `.env` and fill in your project URL and anon key

```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

### AI assistant setup (optional)

The AI assistant stores API keys in `localStorage` — no backend required. On first use, paste an Anthropic or Google AI Studio key into the key field in the chat panel. Keys never leave your browser.

---

## PDF export

```bash
npm run pdf
# Builds the site, serves it, captures via Puppeteer → dist/cv.pdf
```

CI sets `PUPPETEER_SKIP_DOWNLOAD` so `npm ci` does not fetch Chromium. For local
`npm run pdf`, use a normal `npm install`, or run `npx puppeteer browsers install chrome` if Puppeteer cannot find a browser.

The PDF is generated from the same HTML as the web view, using `@media print`. What you see in Print Preview is what you get in the PDF.

---

## Tests

The layout engine has a dedicated test suite covering properties that are easy to break during development:

```bash
npm run test:unit                 # Unit tests (vitest) — schema, URL, keys
npm run test:layout-determinism   # Same input must produce same layout every time
npm run test:layout-recalc        # Layout must be stable under sequential edits
npm run test:layout-audit         # Edit sequence regression suite
npm run test:layout               # Full quality evaluation across test cases
```

The determinism and recalculation tests are property-based: they run multiple passes and assert that measurements converge. Layout changes that introduce instability fail these tests before they reach the PDF.

---

## Design system

All design tokens live in `global.css` `:root`. Changing a token updates both the web view and the PDF simultaneously.

| Token group | What it controls |
|---|---|
| `--color-sidebar` | Sidebar background (drives all sidebar text/border derivations) |
| `--color-ink-*` | Main column text hierarchy (ink, dark, mid, muted, border) |
| `--color-teal-*` | Accent colors in main column (dates, positions, bullet markers) |
| `--sidebar-width` | Default sidebar width before engine override |
| `--text-*` | Type scale (name, label, section, body, meta, bullet, …) |
| `--font-body` / `--font-heading` | Font families (used throughout; swap here to change all) |

---

## Architecture decisions

**Why a client-side layout engine rather than a build-time template?**
Build-time templates fix the layout at compile time. A client-side engine can respond to the actual rendered heights of the current content — which vary with font loading, OS rendering, and content length. The engine measures the DOM after fonts load and searches for the best configuration for that measurement. The PDF captures the same DOM state, so the PDF matches the preview exactly.

**Why no framework (React, Vue, etc.)?**
The layout engine manipulates the DOM directly by ID and CSS custom property. A virtual DOM layer would add reconciliation overhead between engine passes and make it harder to reason about exactly what is in the DOM at measurement time. Vanilla TypeScript with a thin DOM helper layer is easier to reason about for this specific problem.

**Why TypeScript throughout (including scripts)?**
The `CVData` type is the schema contract between content, renderer, AI assistant, and cloud layer. TypeScript catches mismatches at the border before they reach the layout engine.

**Why Supabase?**
Row-level security policies enforce user data isolation at the database layer, not just the application layer. For a tool that stores personal document data, that is the right level to enforce the boundary.

**Why AGPL for the engine?**
The layout engine (`src/lib/engine/`) is separately licensed under AGPL v3. This means it is fully open source — readable, forkable, and usable in open source projects — but any company using it in a proprietary network service must release their modifications. Commercial licences are available for companies that need different terms. See `src/lib/engine/LICENSE`.

---

## Deployment

Every push to `main` deploys automatically via GitHub Actions to GitHub Pages.

Production URL: [blemmy.dev](https://blemmy.dev)

To use a custom domain, add a `CNAME` file to `/public/`:
```
public/
└── CNAME    ← contains your domain, e.g. blemmy.dev
```

---

## Embedding

Blemmy supports read-only embeds for portfolio and published CV use cases.

- Portfolio embed mode: `https://blemmy.dev/?cv-portfolio=1`
- Published document embed mode: `https://blemmy.dev/embed/<publicId>`
- Shared read-only link mode: `https://blemmy.dev/share/<token>`

Recommended integration pattern:

- Desktop: live iframe embed
- Mobile: lightweight preview card + "Open full demo" CTA

Example iframe snippet:

```html
<iframe
  src="https://blemmy.dev/?cv-portfolio=1"
  title="Blemmy demo"
  loading="lazy"
  style="width:100%;min-height:720px;border:0;"
></iframe>
```

For user-published documents:

```html
<iframe
  src="https://blemmy.dev/embed/YOUR_PUBLIC_ID"
  title="Embedded CV"
  loading="lazy"
  style="width:100%;min-height:720px;border:0;"
></iframe>
```

The embed views are read-only and intentionally hide authoring UI.

### Layout search GIF for portfolio

Add a short GIF that shows candidate search and convergence through the layout
space. Recommended placement:

![Blemmy layout search demo](docs/assets/layout-search.gif)

- `docs/assets/layout-search.gif`
- Embed near the top of this README under the project summary.

Markdown snippet:

```markdown
![Blemmy layout search demo](docs/assets/layout-search.gif)
```

Capture approach:

- Run the app with `npm run dev`.
- Open a representative CV case and toggle controls that trigger re-layout.
- Record a 10 to 20 second clip and convert to GIF (for example with `ffmpeg`).

Automated capture (Playwright + ffmpeg):

```bash
# keep dev server running first (npm run dev)
npm run capture:layout-gif
```

This script warms once, measures layout settle time on refresh, records a second
refresh, and trims output so capture starts after the loading splash disappears.

---

## Roadmap

- [ ] `DocumentStyle` schema — bot-addressable colour swatches, font pairs, print sidebar mode
- [ ] Review mode — structured annotation layer with share-link reviewer access
- [ ] Generic `DocumentLayoutSpec` — decouple engine from CV schema (`@blemmy/engine` v1.0)
- [ ] Cover letter as second document type
- [ ] Standalone HTML export
- [ ] Web component (`<blemmy-doc src="./cv.json">`)
- [ ] Self-hosted fonts (offline PDF without Google Fonts)

---

## Licence

The application layer is MIT licensed — see [`LICENSE`](LICENSE).

The layout engine (`src/lib/engine/`) is licensed under AGPL v3 with a commercial licence option — see [`src/lib/engine/LICENSE`](src/lib/engine/LICENSE).
