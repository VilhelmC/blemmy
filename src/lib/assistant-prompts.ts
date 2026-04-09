/**
 * blemmy-chat-prompts.ts
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
import type { CVReview } from '@cv/review-types';
import type { LetterData } from '@cv/letter';
import { getActiveDocumentData } from '@lib/active-document-runtime';
import { describeDocTypeSpec, getDocTypeSpec } from '@lib/document-type';
import { isLikelyCvData } from '@lib/profile-data-loader';
import { buildReviewPromptSection } from '@lib/review-dom';


// ─── Style schema summary (injected when style controls are available) ─────────

const STYLE_SCHEMA_SUMMARY = `
## Document style

You can change the visual style of the document by returning a \`\`\`style block
with a JSON object containing Partial<DocumentStyle> fields.

### Presets — use these names directly:
- "Carbon"     — near-black sidebar, DM Sans (current default)
- "Teal"       — deep teal sidebar, DM Sans
- "Navy"       — navy sidebar, Playfair Display headings
- "Forest"     — dark green sidebar, Cormorant Garamond headings, greyscale print
- "Slate"      — slate blue sidebar, Work Sans — modern neutral tone
- "Ivory"      — dark brown sidebar, warm page, EB Garamond headings
- "Legal"      — dark navy sidebar, Libre Baskerville, greyscale print
- "Mono Print" — dark sidebar, white outline for ink-saving print

### Colours (free entry):
- sidebarColor:   hex string e.g. "#2C3E50" — any colour, contrast auto-adjusted
- pageBackground: hex string e.g. "#F5F3EE" — paper tone in light mode

### Fonts (independent):
- headingFont: "dm-sans" | "playfair-display" | "cormorant-garamond" | "libre-baskerville" | "eb-garamond"
- bodyFont:    "dm-sans" | "work-sans" | "source-sans-3"
- headingDistinct: true = use headingFont for headings; false = single font throughout
- customFontCssUrl: optional https font CSS URL (fonts.googleapis.com or fonts.bunny.net)
- customBodyFontFamily: optional CSS font-family string for body
- customHeadingFontFamily: optional CSS font-family string for headings

### Print sidebar:
- printSidebar: "color" | "grayscale" | "outline"

### Custom CSS vars (allowlisted keys only):
- customCssVars can override: --text-body, --text-meta, --text-label, --text-name
- and print/layout tokens: --print-main-padding, --print-sidebar-padding
- plus alignment/slack tokens: --blemmy-slack-gap-p*-*, --blemmy-align-gap-p*-*

### Response format:
\`\`\`style
{ "presetName": "Navy" }
\`\`\`
or with custom values:
\`\`\`style
{ "sidebarColor": "#4A1A3A", "headingFont": "cormorant-garamond", "headingDistinct": true }
\`\`\`

Only return a style block if the user has asked to change the visual style.
Style changes are applied immediately — no page reload needed.
`.trim();


// ─── Layout state ─────────────────────────────────────────────────────────────

export type LayoutState = {
	pages:        number;
	disposition:  string;
	nearOverflow: boolean;
	sidebarMm:    number | null;
	density:      number;
	activeFilters: string[];
};

/** Registered document type id (see doctype JSON `docType`). */
export type ActiveDocType = string;
export type ActiveDocData = CVData | LetterData;
export type PromptContextMode = 'minimal' | 'full';

/**
 * Reads the current layout state from #blemmy-card data attributes.
 * Call this just before building the system prompt so it reflects the
 * most recent layout pass.
 */
export function readLayoutState(): LayoutState {
	const card = document.getElementById('blemmy-card');
	const data = getActiveDocumentData();
	const activeFilters = isLikelyCvData(data) ? (data.activeFilters ?? []) : [];

	if (!card) {
		return {
			pages: 1, disposition: 'unknown', nearOverflow: false,
			sidebarMm: null, density: 0, activeFilters,
		};
	}

	return {
		pages:        parseInt(card.dataset.blemmyLayoutPages ?? '1', 10),
		disposition:  card.dataset.blemmyLayoutDisposition ?? 'unknown',
		nearOverflow: card.hasAttribute('data-blemmy-layout-overflow-risk'),
		sidebarMm:    card.dataset.blemmyLayoutSidebarMm
			? parseInt(card.dataset.blemmyLayoutSidebarMm, 10)
			: null,
		density:      parseInt(card.dataset.blemmyLayoutDensity ?? '0', 10),
		activeFilters,
	};
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SCHEMA_SUMMARY = `
CV JSON schema (TypeScript interfaces):

interface CVData {
  meta:          { lastUpdated, version, language }
  basics:        { name, label, email, phone, location, nationality, born, summary }
  education:     Array<{ institution, area, degree, startDate, endDate, score?, highlights[], tags? }>
  work:          Array<{ company, position, startDate, endDate, summary?, highlights[], tags? }>
  skills:        Record<string, string[]>  // dynamic category keys → skill lists
  languages:     Array<{ language, fluency }>
  personal:      { interests }
  visibility?:   { hiddenWork?: number[], hiddenEducation?: number[], hiddenSections?: string[],
                   hiddenWorkHighlights?: Record<string, number[]>,
                   hiddenEducationHighlights?: Record<string, number[]>,
                   hiddenSkillItems?: Record<string, number[]>, hiddenLanguages?: number[] }
  activeFilters?: string[]
}

Highlights use a "Lead: Body" format where the lead is bolded, e.g.:
  "Predictive Modelling: Developed advanced models for the EU-funded Fungateria project."

Tags are lowercase strings added to work/education items for filtering:
  "tags": ["research", "technical", "finance"]

Visibility hides items by index (hiddenWork: [1, 3] hides work items at index 1 and 3).
activeFilters: when set, only items with at least one matching tag are shown (untagged items always show).
`.trim();

const LETTER_SCHEMA_SUMMARY = `
Letter JSON schema (TypeScript interfaces):

interface LetterData {
  meta:      { lastUpdated, version, language, targetRole? }
  basics:    { name, label, email, phone, location }
  recipient: { name?, title?, organisation?, address? }
  date:      string
  subject?:  string
  opening:   string
  body:      Array<{ text: string }>
  closing:   { salutation, name, title? }
}
`.trim();

function tokenizePath(path: string): string[] {
	return path
		.replace(/\[(\d+)\]/g, '.$1')
		.split('.')
		.filter(Boolean);
}

function valueAtPath(root: unknown, path: string): unknown {
	let cur: unknown = root;
	for (const token of tokenizePath(path)) {
		if (cur == null || typeof cur !== 'object') { return undefined; }
		if (Array.isArray(cur)) {
			const idx = Number(token);
			if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
				return undefined;
			}
			cur = cur[idx];
			continue;
		}
		cur = (cur as Record<string, unknown>)[token];
	}
	return cur;
}

function buildScopedContextSection(data: ActiveDocData, paths: string[]): string {
	const unique = Array.from(new Set(paths)).slice(0, 24);
	if (unique.length === 0) { return ''; }
	const snippets = unique
		.map((path) => ({ path, value: valueAtPath(data, path) }))
		.filter((entry) => entry.value !== undefined)
		.map((entry) => `- ${entry.path}: ${JSON.stringify(entry.value)}`);
	if (snippets.length === 0) { return ''; }
	return `## Scoped content focus\n${snippets.join('\n')}`;
}

function buildDocTypeSummary(docType: ActiveDocType): string {
	const spec = getDocTypeSpec(docType);
	if (!spec) { return ''; }
	return `## Active document type\n${describeDocTypeSpec(spec)}`;
}

function buildRuntimeShapeSummary(data: ActiveDocData): string {
	const root = data as unknown as Record<string, unknown>;
	const keys = Object.keys(root).sort();
	const lines = keys.map((key) => {
		const value = root[key];
		if (Array.isArray(value)) {
			return `- ${key}: array(${value.length})`;
		}
		if (value && typeof value === 'object') {
			return `- ${key}: object`;
		}
		return `- ${key}: ${typeof value}`;
	});
	return `Document JSON shape:\n${lines.join('\n')}`;
}

function schemaSummaryForDoc(docType: ActiveDocType, docData: ActiveDocData): string {
	if (docType === 'cv') { return SCHEMA_SUMMARY; }
	if (docType === 'letter') { return LETTER_SCHEMA_SUMMARY; }
	return buildRuntimeShapeSummary(docData);
}

/**
 * Builds the full system prompt for a chat session.
 * Called once when the panel opens or when the CV data changes.
 *
 * @param cv          The current rendered CV data
 * @param layout      Current layout engine state
 * @param sourceText  Optional source material (uploaded background document).
 *                    When present, the model can suggest additions and changes
 *                    based on information not yet on the CV.
 */
export function buildSystemPrompt(
	cv:          CVData,
	layout:      LayoutState,
	sourceText?: string,
	review?:     CVReview,
): string {
	const layoutSummary = [
		`Current layout: ${layout.pages} page(s)`,
		layout.disposition !== 'unknown' ? `disposition: ${layout.disposition}` : '',
		layout.nearOverflow ? '⚠ near page overflow' : '',
		layout.sidebarMm    ? `sidebar: ${layout.sidebarMm}mm` : '',
		layout.density > 0  ? `typography density: ${layout.density}` : '',
		layout.activeFilters.length > 0
			? `active tag filters: ${layout.activeFilters.join(', ')}`
			: 'no tag filters active',
	].filter(Boolean).join(' · ');

	const allTags = Array.from(new Set([
		...cv.work.flatMap((w) => w.tags ?? []),
		...cv.education.flatMap((e) => e.tags ?? []),
	])).sort();

	const tagsSummary = allTags.length > 0
		? `Known tags in this CV: ${allTags.join(', ')}`
		: 'No tags defined yet (user can add them in edit mode).';

	// Source material section — included when the user has uploaded background docs
	const reviewSection = review ? buildReviewPromptSection(review) : '';

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
`.trim()
		: '';

	return `You are a professional CV assistant with deep knowledge of CV writing, layout, and strategy. You help users improve their CV content, understand their layout, and prepare tailored versions for specific roles.

${SCHEMA_SUMMARY}

${tagsSummary}

${layoutSummary}

## What you can do

**Answer questions** about the CV, layout, writing quality, or strategy. Be direct and specific.

**Suggest improvements** to copy, structure, or emphasis. Explain your reasoning briefly.

**Suggest additions from source material** — if source material is available, you can identify experiences or qualifications present in the source but missing from the CV and suggest adding them. Always ask before adding — don't apply changes without instruction.

**Apply changes** — when the user asks you to modify the CV, return the COMPLETE updated JSON in a fenced code block:
\`\`\`json
{ ... complete CVData object ... }
\`\`\`
The app will validate and apply it automatically. Always return the entire CVData, not a diff. Do not truncate.

**Suggest tags** — recommend tags for work/education items to help the user create filtered versions for different roles.

## Guidelines

- Keep bullet points in "Lead: Body" format where the lead is bolded (e.g. "Predictive Modelling: Built X...")
- Highlights should be 1–2 lines, concrete, and outcome-focused
- The label field uses ' · ' as a separator between parts
- Dates use year strings (e.g. "2020", "2022")
- When writing for a specific role, favour results and transferable skills over tasks
- If the layout is near overflow, mention that removing or shortening content would help
- Tags should be lowercase, short, thematic (e.g. "research", "finance", "technical")
- Only use facts from the CV JSON or the source material — never invent

${reviewSection ? reviewSection + '\n\n' : ''}${STYLE_SCHEMA_SUMMARY}

## Current CV data
\`\`\`json
${JSON.stringify(cv, null, 2)}
\`\`\`

${sourceSection}`.trim();
}

export function buildRoutedSystemPrompt(args: {
	docType: ActiveDocType;
	docData: ActiveDocData;
	layout: LayoutState;
	sourceText?: string;
	review?: CVReview;
	contextMode: PromptContextMode;
	scopedPaths?: string[];
	includeReview?: boolean;
}): string {
	if (args.docType === 'cv' && args.contextMode === 'full') {
		const cv = args.docData as CVData;
		const full = buildSystemPrompt(
			cv,
			args.layout,
			args.sourceText,
			args.includeReview ? args.review : undefined,
		);
		const scoped = buildScopedContextSection(cv, args.scopedPaths ?? []);
		return scoped ? `${full}\n\n${scoped}` : full;
	}
	const scoped = buildScopedContextSection(args.docData, args.scopedPaths ?? []);
	const sourceSection = args.sourceText
		? `
## Source material
\`\`\`
${args.sourceText.slice(0, 12000)}${args.sourceText.length > 12000 ? '\n\n[… truncated]' : ''}
\`\`\`
`.trim()
		: '';
	const reviewSection = args.includeReview && args.review
		? buildReviewPromptSection(args.review)
		: '';
	const dataSection = args.contextMode === 'full'
		? `
## Current document data
\`\`\`json
${JSON.stringify(args.docData, null, 2)}
\`\`\`
`.trim()
		: '';
	return `You are a professional document assistant.

${schemaSummaryForDoc(args.docType, args.docData)}

${buildDocTypeSummary(args.docType)}

${[
	`Current layout: ${args.layout.pages} page(s)`,
	args.layout.disposition !== 'unknown' ? `disposition: ${args.layout.disposition}` : '',
	args.layout.nearOverflow ? 'near overflow' : '',
].filter(Boolean).join(' · ')}

When asked to apply content changes, return COMPLETE JSON for the current document in a fenced \`\`\`json block.
When asked for style changes, return a \`\`\`style block only.

${STYLE_SCHEMA_SUMMARY}

${scoped}

${reviewSection}

${dataSection}

${sourceSection}`.trim();
}

// ─── Starter suggestions ──────────────────────────────────────────────────────

/**
 * Context-aware starter prompts shown before the first message.
 * Rotate based on what's interesting about the current state.
 */
export function buildStarterSuggestions(
	cv:            CVData,
	layout:        LayoutState,
	hasSourceText: boolean = false,
): string[] {
	const starters: string[] = [];

	// Source-aware starters take priority
	if (hasSourceText) {
		starters.push('What\'s in my source material that isn\'t on my CV yet?');
		starters.push('Are there any skills or experiences in my background I should add?');
	}

	// Always relevant
	starters.push('How can I make my profile summary stronger?');
	starters.push('Which bullet points are weakest and how should I improve them?');

	// Tag-related
	const allTags = Array.from(new Set([
		...cv.work.flatMap((w) => w.tags ?? []),
		...cv.education.flatMap((e) => e.tags ?? []),
	]));
	if (allTags.length === 0) {
		starters.push('Suggest tags for my work items so I can filter by role type.');
	} else if (layout.activeFilters.length > 0) {
		starters.push(`I'm targeting a ${layout.activeFilters.join('/')} role — what should I emphasise?`);
	}

	// Layout-related
	if (layout.nearOverflow) {
		starters.push('The layout is near overflow — what should I cut to fit on one page?');
	}
	if (layout.pages === 2) {
		starters.push('Can you tighten my content to fit on one page?');
	}

	// Role-specific
	starters.push('Rewrite my CV for a senior real estate investment role.');
	starters.push('Adapt my summary for an architecture research position.');

	return starters.slice(0, 4);
}

export function buildStarterSuggestionsForDoc(
	docType:       ActiveDocType,
	docData:       ActiveDocData,
	layout:        LayoutState,
	hasSourceText: boolean,
): string[] {
	if (docType === 'cv') {
		return buildStarterSuggestions(docData as CVData, layout, hasSourceText);
	}
	const starters: string[] = [];
	if (hasSourceText) {
		starters.push('Use my source material to strengthen this cover letter.');
	}
	starters.push('Rewrite this letter for a more concise and confident tone.');
	starters.push('Tailor this cover letter for a senior role.');
	starters.push('Improve paragraph flow and reduce repetition.');
	if (layout.nearOverflow) {
		starters.push('Shorten this letter so it fits cleanly on one page.');
	}
	return starters.slice(0, 4);
}

// ─── Generate CV from source text ─────────────────────────────────────────────

/**
 * System prompt for the "create CV from scratch" mode.
 * Used when the user uploads a document or pastes background text and
 * asks the assistant to generate a complete blemmy-content.json.
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
- **skills**: Object whose keys are category names (start with a letter; may use spaces or hyphens; no dots in the key) and values are string arrays. Group logically (e.g. technical, design, leadership); infer from context.
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
	// The bundled default uses this sentinel name.
	return cv.basics.name === 'Blemmy Kerning';
}

