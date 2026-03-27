/**
 * document-type-spec.ts
 *
 * Type contracts for Blemmy document type specifications.
 *
 * A DocumentTypeSpec is a JSON-serialisable description of a document type.
 * It captures the layout model, sections, and wiring needed to:
 *   - Drive the layout engine (via deriveEngineSpec())
 *   - Render the document DOM
 *   - Validate and edit document content
 *   - Store and compare document formats in the database
 *   - Be edited by the AI assistant
 *
 * The three built-in specs live in src/data/doctypes/:
 *   cv.doctype.json          — Curriculum Vitae (sidebar-main, 2 pages)
 *   letter.doctype.json      — Cover Letter (single-column, 1 page)
 *   portfolio.doctype.json   — Portfolio (single-column, multi-page stub)
 */

// ─── Layout model ─────────────────────────────────────────────────────────────

/**
 * The high-level layout architecture of the document.
 *
 * sidebar-main   Two-column A4: fixed sidebar + main column. Up to 2 pages.
 *                Full engine candidate search. (CV)
 *
 * single-column  Single full-width column on A4. One page preferred.
 *                Simplified engine: fill + slack only, no candidate search. (Letter)
 *
 * multi-page     Single-column, unconstrained page count. Projects/portfolio.
 *                Engine: fill + slack per page. (Portfolio)
 */
export type LayoutModel = 'sidebar-main' | 'single-column' | 'multi-page';

export interface LayoutConfig {
	model:        LayoutModel;
	/** Maximum number of pages. null = unconstrained. */
	maxPages:     number | null;
	pageSize:     'A4';   // only A4 for now; future: 'Letter', 'A3'
	/** Whether the document has a portrait photo cell. */
	hasPortrait:  boolean;
	/** Whether the document has a masthead identity band. */
	hasMasthead:  boolean;
	/** Whether the document has page footer zones (for movable sections). */
	hasFooter:    boolean;
}

// ─── Section spec ─────────────────────────────────────────────────────────────

/**
 * How the engine treats a section.
 *
 * fixed-main       Always in the main column. Never moved.
 * fixed-sidebar    Always in the sidebar. Informs minimum sidebar width.
 *                  Only valid with layout.model = 'sidebar-main'.
 * movable          Can move between sidebar and footer. Candidate search axis.
 *                  Only valid with layout.model = 'sidebar-main'.
 * masthead         Rendered in the masthead area. Not a layout engine concern.
 * profilable       Profiled (width-sensitivity measured) but not movable.
 *                  Used for masthead topology decisions in sidebar-main.
 */
export type SectionPlacement =
	| 'fixed-main'
	| 'fixed-sidebar'
	| 'movable'
	| 'masthead'
	| 'profilable';

export interface SectionSpec {
	/** Logical section identifier. Used in candidate IDs, labels, DOM IDs. */
	id:          string;
	/** Human-readable section label. */
	label:       string;
	placement:   SectionPlacement;
	/**
	 * Whether multiple instances of this section exist (e.g. one per job entry).
	 * Repeating sections with placement 'fixed-main' inform workCount for the
	 * engine's page-split search.
	 */
	repeating?:  boolean;
}

// ─── DOM wiring ───────────────────────────────────────────────────────────────

/**
 * Optional overrides for derived DOM element IDs.
 *
 * By convention, element IDs are derived as:
 *   card:    `{domPrefix}-card`
 *   shell:   `{domPrefix}-shell`
 *   page1:   `{domPrefix}-page-1`
 *   section: `{domPrefix}-section-{sectionId}`
 *   etc.
 *
 * Overrides are provided for backward compatibility with existing DOM IDs
 * that predate this convention (e.g. `cv-rebalance-skills` instead of
 * the derived `cv-section-skills`).
 */
export interface DomIdOverrides {
	card?:         string;
	shell?:        string;
	page1?:        string;
	page2?:        string;
	sidebar1?:     string;
	sidebar2?:     string;
	main1?:        string;
	main2?:        string;
	statusEl?:     string;
	footer1?:      string;
	footer2?:      string;
	masthead?:     string;
	portraitCell?: string;
	mastheadRight?:string;
	profileCol?:   string;
	/** Per-section ID overrides. Key = sectionId. */
	sections?:     Record<string, string>;
}

/**
 * Optional CSS class name overrides.
 * Defaults match the existing CV class names for backward compatibility.
 */
export interface CssClassOverrides {
	singlePage?:     string;
	densityPrefix?:  string;
	fillPrefix?:     string;
}

// ─── Root spec ────────────────────────────────────────────────────────────────

/**
 * The complete DocumentTypeSpec. JSON-serialisable.
 *
 * Stored in src/data/doctypes/{docType}.doctype.json.
 * Can be stored per-user in Supabase, uploaded/downloaded, and edited by
 * the AI assistant.
 *
 * The spec does NOT contain content data (that lives in CVData, LetterData, etc.)
 * or style data (that lives in DocumentStyle). It describes the structural
 * shape and layout behaviour of a document type.
 */
export interface DocumentTypeSpec {
	/** Unique document type identifier. Used as doc_type in the database. */
	docType:  string;
	/** Human-readable name shown in the document type selector. */
	label:    string;
	/** Semantic version of the spec itself. Increment when sections change. */
	version:  string;

	layout:   LayoutConfig;

	/**
	 * Prefix for derived DOM element IDs.
	 * Example: 'cv' → card is 'cv-card', section skills is 'cv-section-skills'.
	 */
	domPrefix: string;

	/**
	 * Overrides for derived DOM IDs.
	 * Omit for new document types that follow the convention.
	 * Required for 'cv' which has legacy DOM IDs.
	 */
	domOverrides?: DomIdOverrides;

	/** CSS class name overrides. Omit to use defaults. */
	cssClasses?: CssClassOverrides;

	sections: SectionSpec[];

	/**
	 * Name of the TypeScript content type for this document type.
	 * Informational — used for documentation and tooling hints.
	 * Example: 'CVData', 'LetterData', 'PortfolioData'
	 */
	contentType: string;
}

// ─── Derived DOM ID resolution ────────────────────────────────────────────────

/**
 * Derives the DOM element ID for a named structural slot, applying overrides.
 */
export function deriveDomId(
	slot:      keyof DomIdOverrides,
	domPrefix: string,
	overrides: DomIdOverrides = {},
): string {
	if (slot in overrides && typeof overrides[slot] === 'string') {
		return overrides[slot] as string;
	}
	const SLOT_SUFFIXES: Record<keyof DomIdOverrides, string | null> = {
		card:          '-card',
		shell:         '-shell',
		page1:         '-page-1',
		page2:         '-page-2',
		sidebar1:      '-sidebar-1',
		sidebar2:      '-sidebar-2',
		main1:         '-main-1',
		main2:         '-main-2',
		statusEl:      '-layout-status',
		footer1:       '-page-1-body-footer',
		footer2:       '-page-2-body-footer',
		masthead:      '-page-1-masthead',
		portraitCell:  '-p1-portrait-cell',
		mastheadRight: '-masthead-right',
		profileCol:    '-masthead-profile-col',
		sections:      null,   // handled separately
	};
	const suffix = SLOT_SUFFIXES[slot];
	return suffix ? `${domPrefix}${suffix}` : '';
}

/**
 * Derives the DOM element ID for a section element.
 */
export function deriveSectionDomId(
	sectionId: string,
	domPrefix: string,
	overrides: DomIdOverrides = {},
): string {
	return overrides.sections?.[sectionId] ?? `${domPrefix}-section-${sectionId}`;
}
