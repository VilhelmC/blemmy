# Developer Notes

Internal documentation for the Blemmy project. These docs cover implementation details that are too technical or too specific to belong in the root README.

For the project overview, setup instructions, and architecture summary, see [`../README.md`](../README.md).

---

## Contents

| File | What it covers |
|------|---------------|
| [`cv-layout-engine.md`](cv-layout-engine.md) | Full technical spec for the 8-stage layout pipeline — candidate generation, scoring, binary sidebar search, slack absorption, alignment snapping |
| [`cv-print-single-source.md`](cv-print-single-source.md) | How `global.css`, `print.css`, `cv-print-surface.css`, and `cv-print-parity.css` relate; the print/preview parity problem and its current solution |
| [`supabase-cloud-schema.sql`](supabase-cloud-schema.sql) | Full database schema — run this in the Supabase SQL editor to initialise the cloud backend |
| [`gdpr-data-inventory.md`](gdpr-data-inventory.md) | Data mapping: what personal data is stored, where, for how long, and under what legal basis |
| [`gdpr-dsar-runbook.md`](gdpr-dsar-runbook.md) | Step-by-step runbook for handling data subject access requests (DSARs) |
| [`privacy-policy.md`](privacy-policy.md) | Privacy policy template — review and customise before publishing |
| [`AI-CONTENT-GUIDE.md`](AI-CONTENT-GUIDE.md) | Content formatting rules for `cv-demo.json`; prompt templates for the AI assistant |
| `reports/` | Generated layout diagnostic reports (git-ignored — produced by `npm run test:layout*`) |
