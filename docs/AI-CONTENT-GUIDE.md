# AI Content Guide

Quick reference for generating and editing `cv-content.json` content using AI tools (Claude, ChatGPT, etc.).

This file explains the formatting rules the templates depend on, what makes a good highlight bullet, and includes a ready-to-use prompt you can paste directly into any AI chat.

---

## The JSON Schema at a Glance

```
cv-content.json
│
├── meta          version, date, language
├── basics        name, label, email, phone, location, nationality, born, summary
├── education[]   institution, area, degree, startDate, endDate, score?, highlights[]
├── work[]        company, position, startDate, endDate, summary?, highlights[]
├── skills        programming[], design_bim[], strategic[]
├── languages[]   language, fluency
└── personal      interests
```

Fields marked `?` are optional — omit them entirely rather than leaving them blank.

---

## Formatting Rules

### `basics.label`
- Use `·` (middle dot, U+00B7) as the separator — not a dash, pipe, or slash
- Maximum three parts
- Order: Primary role · Discipline · Qualification

```json
"label": "Strategic Real Estate Consultant · Architect · B.Sc. Business & Economics"
```

### `basics.summary`
- 3–5 sentences maximum
- Written in first person, present tense
- Lead with the bridging value proposition ("I bridge / connect / translate...")
- End with a concrete output: ESG, ROI, feasibility, simulation, etc.
- No buzzwords without a following concrete example
- Target length: 60–80 words

### `work[].highlights`
Each highlight must follow the **Lead: Body** format:

```
"Lead keyword: One sentence describing what you did and why it mattered."
```

- The lead is 1–3 words, title-cased, followed by a colon
- The body is a single sentence — no sub-clauses, no semicolons
- The lead renders **bold** automatically — choose it to be the scannable signal word
- 2–4 highlights per role for primary roles, 1–2 for supporting roles
- Verbs: past tense for completed roles, present tense for current roles
- Quantify when possible — not "improved performance" but "reduced simulation runtime by 40%"

**Good:**
```json
"Predictive Modelling: Developed mathematical models for the EU Fungateria project to simulate material performance across 3D growth environments."
```

**Bad:**
```json
"Was responsible for developing models that were used in the Fungateria project for simulating various material performance metrics in different environments."
```

**Bad (no lead):**
```json
"Developed models for the Fungateria project."
```

### `work[].summary`
- Optional — use only for roles where the scope needs a single framing sentence
- Rendered in italic below the title, above the highlights
- 1 sentence maximum

### `education[].highlights`
- 1–2 items maximum
- First item should always be the thesis or specialisation
- No lead: prefix needed — these are plain sentences

### `skills`
Three fixed categories — do not rename them (the component maps them by key):

| Key | Contains |
|---|---|
| `programming` | Languages, frameworks, APIs |
| `design_bim` | Software tools, CAD, BIM, creative suite |
| `strategic` | Methods, analysis types, domain competencies |

- Each item is a short noun phrase — no sentences
- Append `(Advanced)` or `(Proficient)` only for tools where level is non-obvious
- 4–8 items per category is the readable range

### `languages[].fluency`
Must be one of these exact strings (TypeScript will reject anything else at build time):

```
"Native"
"Fluent"
"Professional Working Proficiency"
"Conversational"
"Basic"
```

### Dates
- `startDate` and `endDate` use year strings only: `"2022"` not `"2022-06"` or `"June 2022"`
- For current positions use the current year: `"2026"`
- `basics.born` uses ISO format: `"1991-10-28"`

---

## Page assignment rules

The **initial** page split comes from **`work[]` order** (after any tag filters): the **first two visible** entries render on **page 1**, the **rest** on **page 2** (`src/renderer/cv-renderer.ts`). The **layout engine** may still move blocks for print fit.

| Page | Default rule |
|---|---|
| Page 1 (main column) | First two visible `work[]` entries |
| Page 2 (main column) | Remaining visible entries |

Reorder roles in the JSON (or use edit-mode drag) to change which jobs lead on page 1 vs 2.

---

## Content Budget Per Page

This is the approximate content that fits per page without overflow.
Treat this as a warning threshold — if you exceed it, check the PDF for a third page.

**Page 1 — Main column:**
- Summary: max 80 words
- 2 work entries × max 4 highlights each

**Page 2 — Main column:**
- 2 work entries × max 2 highlights each
- SimPlaceholder (`data-cv-interactive`, screen-only; omitted from print/PDF)

**Sidebar (both pages):**
- Education: 2 entries comfortably, 3 is tight
- Skills: 4–8 items per category
- Languages: up to 6 entries

---

## Ready-to-Use AI Prompt

Copy and paste this into Claude, ChatGPT, or any other AI tool. Fill in the `[bracketed]` sections before sending.

---

```
You are helping me update my CV content. My CV uses a structured JSON file as
its single source of truth. A Vite app renders the JSON into a two-column A4
layout and PDF — I do not manually format anything.

Your job is to write or rewrite content that fits the following rules exactly.
Do not add commentary, explanations, or alternative versions unless I ask.
Return only the JSON fragment I request.

--- FORMATTING RULES ---

1. HIGHLIGHTS follow a strict "Lead: Body" format.
   - Lead: 1–3 title-cased words, followed by a colon.
   - Body: one sentence, past tense for past roles, present for current.
   - The lead renders bold automatically — make it the signal word a
     recruiter scanning quickly would notice.
   - Good: "Predictive Modelling: Developed advanced mathematical models..."
   - Bad: "Was responsible for developing models that were used in..."

2. SUMMARY is 60–80 words, first person, present tense.
   Lead sentence bridges two domains (e.g. architecture + finance).
   End with a concrete output (ESG, ROI, simulation, feasibility).

3. LABEL uses · (middle dot) as separator. Max three parts.
   Format: Primary Role · Discipline · Qualification

4. SKILLS are short noun phrases only. No sentences.
   Append "(Advanced)" only where skill level is non-obvious.

5. DATES are year strings only: "2022" not "June 2022".

6. FLUENCY must be one of:
   Native / Fluent / Professional Working Proficiency / Conversational / Basic

--- MY REQUEST ---

[Describe what you want here. Examples:]

Write 3 highlights for a new role at [Company] as [Position] from [Year] to
[Year]. The role involved: [brief description of responsibilities].

OR

Rewrite my summary to emphasise my [specific angle, e.g. PropTech / ESG /
real estate investment] background. Current summary: "[paste current text]"

OR

Add a new work entry for [Company], [Position], [Year–Year].
Key responsibilities: [bullet points of what you did].
Return a complete work object ready to paste into the JSON array.

--- CONTEXT ---

My background:
- M.A. Architecture (Computation), Royal Danish Academy, 2022, grade 12/12
- B.Sc. Business & Economics, Stockholm School of Economics, 2015
- Current role: Research Assistant at CITA (EU Fungateria project,
  predictive modelling, WebGPU/Python)
- Previous: Financial Editor, Business Insider Nordic (Bonnier)
- Skills: Python, JavaScript, WebGPU, Rhino/Grasshopper, Houdini,
  spatial optimisation, ESG reporting, financial feasibility

Target audience for this version of the CV: [e.g. PropTech firms / 
real estate investment / architecture R&D / computational design studios]
```

---

## Common Edits Cheatsheet

| Task | What to edit |
|---|---|
| Update a job title | `work[n].position` |
| Add a highlight bullet | Append to `work[n].highlights[]` |
| Change the summary | `basics.summary` |
| Add a new skill | Append to `skills.programming[]`, `.design_bim[]`, or `.strategic[]` |
| Add a language | Append to `languages[]` with an exact fluency string |
| Change contact info | `basics.email`, `basics.phone`, `basics.location` |
| Add a new role | Append a full object to `work[]` (order sets default page split) |
| Remove a role | Delete the object from `work[]` |
