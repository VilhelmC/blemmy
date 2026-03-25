/**
 * cv-chat-prompts.ts
 *
 * Builds the system prompt and context object passed to the LLM.
 *
 * The system prompt explains:
 *   - What the assistant can do (answer questions, suggest changes, apply changes)
 *   - The JSON schema for CV data
 *   - The tag / filter system
 *   - The visibility system
 *   - How to return modifications (complete JSON in a fenced block)
 *   - The current layout state
 *
 * Keeping prompts in a separate module makes them easy to tune without
 * touching the API or UI code.
 */

import type { CVData } from '@cv/cv';

// ─── Layout state ─────────────────────────────────────────────────────────────

export type LayoutState = {
	pages:        number;
	disposition:  string;
	nearOverflow: boolean;
	sidebarMm:    number | null;
	density:      number;
	activeFilters: string[];
};

/**
 * Reads the current layout state from #cv-card data attributes.
 * Call this just before building the system prompt so it reflects the
 * most recent layout pass.
 */
export function readLayoutState(): LayoutState {
	const card          = document.getElementById('cv-card');
	const data          = window.__CV_DATA__;
	const activeFilters = data?.activeFilters ?? [];

	if (!card) {
		return { pages: 1, disposition: 'unknown', nearOverflow: false, sidebarMm: null, density: 0, activeFilters };
	}

	const pages      = card.dataset.cvPages === '2' ? 2 : 1;
	const disp       = card.dataset.cvDisposition ?? 'unknown';
	const sidebarRaw = card.dataset.cvSidebarMm;
	const sidebarMm  = sidebarRaw ? parseFloat(sidebarRaw) : null;
	const densityRaw = card.dataset.cvDensity;
	const density    = densityRaw ? parseInt(densityRaw, 10) : 0;

	// Near-overflow: layout engine sets this when content is within ~3% of A4 budget
	const nearOverflow = card.dataset.cvNearOverflow === 'true';

	return { pages, disposition: disp, nearOverflow, sidebarMm, density, activeFilters };
}

// ─── Schema summary (injected into every system prompt) ──────────────────────

const SCHEMA_SUMMARY = `## CV data schema (CVData JSON)

The CV data is a single JSON object with the following top-level fields.
You must return the full object when making changes — never a partial patch.

\`\`\`
{
  meta: {
    lastUpdated: string   // ISO date e.g. "2026-03-25"
    version:     string
    language:    string   // BCP-47 e.g. "en"
  }
  basics: {
    name:        string
    label:       string   // tagline, use " · " as separator
    email:       string
    phone:       string
    location:    string
    nationality: string
    born:        string   // ISO date
    summary:     string   // 2–4 sentences, first-person
  }
  work: Array<{
    company:    string
    position:   string
    startDate:  string    // year e.g. "2022"
    endDate:    string    // year or "Present"
    summary?:   string    // optional one-line role summary
    highlights: string[]  // "Lead: Body" format — lead is 1–3 word noun
    tags?:      string[]  // lowercase thematic tags e.g. ["technical","research"]
  }>
  education: Array<{
    institution: string
    area:        string
    degree:      string
    startDate:   string
    endDate:     string
    score?:      string   // optional GPA / grade
    highlights:  string[]
    tags?:       string[]
  }>
  skills: {
    programming: string[]
    design_bim:  string[]
    strategic:   string[]
  }
  languages: Array<{
    language: string
    fluency:  "Native" | "Fluent" | "Professional Working Proficiency" | "Conversational" | "Basic"
  }>
  personal: {
    interests: string
  }

  // ── Optional fields ───────────────────────────────────────────────────────
  visibility?: {
    hiddenWork?:      number[]          // indices into work[] that are hidden
    hiddenEducation?: number[]          // indices into education[] that are hidden
    hiddenSections?:  ("skills"|"languages"|"interests"|"profile")[]
    sidebarOrder?:    ("skills"|"languages"|"interests")[]
    skillsOrder?:     ("programming"|"design_bim"|"strategic")[]
  }
  activeFilters?: string[]             // active tag filters — empty = show all
}
\`\`\`

## Highlight format

Every highlight bullet must follow "Lead: Body" format.
- Lead: a 1–3 word skill or outcome noun (bold in the rendered CV)
- Body: a concrete sentence. Include a measurable result where possible.

Example:
  "Platform: Designed and shipped a massing tool used on six live projects — reduced iteration time from weeks to hours."
  NOT: "I worked on a massing tool that helped architects."

## Tags

Tags are lowercase strings used for role-specific filtering. Good tags:
  technical · research · strategy · leadership · design · computational ·
  academic · communication · finance · management

Add 2–4 tags to each work and education entry. Untagged items always show.`;

// ─── Layout state description ─────────────────────────────────────────────────

function describeLayout(layout: LayoutState): string {
	const lines: string[] = [];

	lines.push(`## Current layout state`);
	lines.push(`- Pages: ${layout.pages}`);
	lines.push(`- Disposition: ${layout.disposition}`);
	if (layout.sidebarMm !== null) {
		lines.push(`- Sidebar width: ${layout.sidebarMm.toFixed(1)} mm`);
	}
	lines.push(`- Density tier: ${layout.density}`);
	if (layout.nearOverflow) {
		lines.push(`- ⚠️  Near overflow — content is close to the A4 page budget. Suggest trimming.`);
	}
	if (layout.activeFilters.length > 0) {
		lines.push(`- Active filters: ${layout.activeFilters.join(', ')} — only tagged items matching these filters are shown`);
	} else {
		lines.push(`- Active filters: none — all content is visible`);
	}

	return lines.join('\n');
}

// ─── Main system prompt ───────────────────────────────────────────────────────

/**
 * @param sourceText  Optional uploaded background — the model may suggest CV gaps.
 */
export function buildSystemPrompt(
	cv: CVData,
	layout: LayoutState,
	sourceText?: string,
): string {
	const sourceSection = sourceText
		? `

## Source material (uploaded background document)

The user uploaded a document as the basis for their CV. The text below may contain
experiences, qualifications, skills, and details **not yet reflected in the CV**.
Use this to suggest additions, fill gaps, and improve accuracy. Do not invent facts
that are not in either the CV or the source material.

\`\`\`
${sourceText.slice(0, 12000)}${sourceText.length > 12000 ? '\n\n[… truncated]' : ''}
\`\`\`
`
		: '';

	return `You are a professional CV writing assistant. You help users write, edit, and improve their CV.

You have access to the user's complete CV data (shown below) and to the current layout state of the rendered document.

## What you can do

1. **Answer questions** about the CV content, layout, or how to improve it.
2. **Suggest changes** — explain what you would change and why.
3. **Apply changes** — return a modified version of the complete CV JSON.

When applying changes, always return the complete \`CVData\` object in a fenced JSON block:
\`\`\`json
{ ... complete CVData ... }
\`\`\`

Do not return partial patches. Do not omit fields that are unchanged.
Only return a JSON block if you are actually making changes.

${SCHEMA_SUMMARY}

${describeLayout(layout)}

## Current CV data

\`\`\`json
${JSON.stringify(cv, null, 2)}
\`\`\`${sourceSection}`;
}

// ─── Starter suggestions ──────────────────────────────────────────────────────

export function buildStarterSuggestions(
	cv: CVData,
	layout: LayoutState,
	hasSourceText = false,
): string[] {
	const starters: string[] = [];

	if (hasSourceText) {
		starters.push('What\'s in my source material that isn\'t on my CV yet?');
		starters.push('Are there any skills or experiences in my background I should add?');
	}

	if (layout.nearOverflow) {
		starters.push('My CV is nearly full — what should I trim?');
	}
	if (layout.pages === 2) {
		starters.push('Can you tighten my content to fit on one page?');
	}

	starters.push('Review my bullet points and suggest stronger "Lead: Body" rewrites.');
	starters.push('Improve my summary paragraph — make it more distinctive.');

	const allTags = Array.from(new Set([
		...cv.work.flatMap((w) => w.tags ?? []),
		...cv.education.flatMap((e) => e.tags ?? []),
	]));
	if (allTags.length === 0) {
		starters.push('Suggest tags for my work items so I can filter by role type.');
	} else if (layout.activeFilters.length > 0) {
		starters.push(`I'm targeting a ${layout.activeFilters.join('/')} role — what should I emphasise?`);
	}

	starters.push('Rewrite my CV for a senior design technology leadership role.');
	starters.push('Adapt my summary for a computational research position.');

	return starters.slice(0, 4);
}

// ─── Generate CV from source text ─────────────────────────────────────────────

/**
 * System prompt for the "create CV from scratch" mode.
 * Used when the user uploads a document or pastes background text and
 * asks the assistant to generate a complete cv-content.json.
 */
export function buildGenerateSystemPrompt(): string {
	return `You are a professional CV writer. Your task is to create a complete, well-structured CV in JSON format from source material the user provides (a bio, LinkedIn export, list of experiences, Word document text, or similar).

${SCHEMA_SUMMARY}

## Output rules

Always return the complete CVData JSON in a fenced code block:
\`\`\`json
{ ... }
\`\`\`

Guidelines for generating the JSON:
- **basics.name**: Extract the person's full name. If not found, use "Your Name".
- **basics.label**: Compose a professional tagline using ' · ' as separator. Max 3 parts, e.g. "Software Engineer · Computational Design · M.Sc. Computer Science"
- **basics.summary**: Write 2–4 sentences, first-person, outcome-focused. Bridge between their background and what makes them distinctive.
- **work**: Extract all roles. Write highlight bullets in "Lead: Body" format — lead is a 1–3 word skill/outcome noun, body is a concrete sentence with result if possible.
- **education**: Extract all qualifications. Include score only if explicitly mentioned.
- **skills**: Categorise technical skills into programming, design_bim, and strategic groups. Infer from context if not explicit.
- **languages**: Include only if mentioned. Use standard fluency levels: Native, Fluent, Professional Working Proficiency, Conversational, Basic.
- **tags**: Add 2–4 lowercase thematic tags to each work and education entry based on the nature of the role (e.g. "research", "finance", "design", "technical", "strategy", "academic", "communication").
- **meta**: Set lastUpdated to today's date, version to "1.0", language to "en" (or detected language).
- Fill in placeholder values for any fields not found in the source (e.g. email: "your@email.com").
- Do not invent facts — use exactly what is in the source material.

Return ONLY the JSON block. No commentary before or after.`;
}

/**
 * User message that wraps source text for the generate-from-scratch flow.
 * This is sent as the first user turn to the generate prompt.
 */
export function buildGenerateUserMessage(sourceText: string, filename?: string): string {
	const header = filename
		? `Here is my background information from the file "${filename}":`
		: 'Here is my background information:';

	return `${header}\n\n---\n${sourceText}\n---\n\nPlease create a complete CV JSON from this.`;
}

/**
 * Starter suggestions for onboarding mode (no real CV data yet).
 */
export function buildOnboardingStarters(): string[] {
	return [
		'Upload a document (Word, PDF, or text) describing your experience.',
		'Paste your LinkedIn About section or bio and I\'ll build your CV.',
		'Describe your work history and I\'ll structure it into a CV.',
		'Upload your existing CV as a .docx or .txt to import it.',
	];
}

/**
 * Returns true if the current CV data appears to be the bundled default
 * (i.e. no real user data has been loaded yet).
 * Used to decide whether to show onboarding starters.
 */
export function isDefaultCvData(cv: CVData): boolean {
	// The bundled default uses the demo persona name — if it differs, user has real data
	return cv.basics.name === 'Alex Meridian';
}
