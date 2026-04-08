/**
 * document-spec.ts
 *
 * The EngineDocumentSpec type is the injection contract between a calling
 * application and the Blemmy layout engine. It tells the engine where to
 * find elements in the DOM and which sections it is allowed to move.
 *
 * The engine itself contains no hardcoded DOM IDs, section names, or
 * topology variant IDs. Every document-specific identifier comes from the spec
 * provided at init time.
 *
 * The CV application provides CV_DOCUMENT_SPEC (src/lib/blemmy-document-spec.ts).
 * Future document types (cover letter, portfolio) provide their own specs.
 */

// ─── Core spec ────────────────────────────────────────────────────────────────

export interface EngineDocumentSpec {

	// ── Required structural element IDs ──────────────────────────────────────

	/**
	 * Root card element. Receives layout classes and `data-blemmy-layout-*`
	 * telemetry written by the engine (document-agnostic surface).
	 */
	cardId:     string;
	/** Outer shell element. Receives view-mode classes (blemmy-print-preview). */
	shellId:    string;
	/** Page 1 wrapper. */
	page1Id:    string;
	/** Page 2 wrapper. */
	page2Id:    string;
	/** Sidebar column — page 1 (or only page on single-page layouts). */
	sidebar1Id: string;
	/** Sidebar column — page 2. */
	sidebar2Id: string;
	/** Main column — page 1. */
	main1Id:    string;
	/** Main column — page 2. */
	main2Id:    string;

	// ── Optional structural element IDs ──────────────────────────────────────

	/** Layout status badge element. */
	statusElId?:      string;
	/** Page-1 body footer (hosts movable sections in p1-footer placement). */
	footer1Id?:       string;
	/** Page-2 body footer (hosts movable sections in p2-footer placement). */
	footer2Id?:       string;
	/** Masthead wrapper on page 1. */
	mastheadId?:      string;
	/** Portrait image cell. */
	portraitCellId?:  string;
	/** Right-hand portion of the masthead (identity + contact). */
	mastheadRightId?: string;
	/** Profile column within the masthead (for masthead-mode topology changes). */
	profileColId?:    string;

	// ── Sections ─────────────────────────────────────────────────────────────

	/**
	 * Sections the engine may move between sidebar and footer.
	 * Key = logical section name (used in candidate IDs and labels).
	 * Value = DOM element ID the engine will look up via getElementById.
	 *
	 * Example for a CV:
	 *   { skills: 'blemmy-rebalance-skills', languages: 'blemmy-rebalance-languages', interests: 'blemmy-rebalance-interests' }
	 */
	movableSections: Record<string, string>;

	/**
	 * Element IDs of sections that always live in the sidebar.
	 * These are profiled to inform the minimum sidebar width calculation
	 * but are never moved by the engine.
	 *
	 * Example: ['blemmy-education']
	 */
	alwaysSidebarIds: string[];

	/**
	 * Element IDs of sections that should be profiled but are neither
	 * movable nor always-sidebar. Typically: content that the engine uses
	 * to decide masthead topology (e.g. the profile/summary paragraph).
	 *
	 * Example: ['blemmy-rebalance-profile']
	 */
	profilableIds?: string[];

	// ── Zone topology variants ────────────────────────────────────────────────

	/**
	 * Discrete topology alternatives for named zones.
	 * Key = zone element ID. Value = ordered variant IDs (first = default).
	 */
	zoneVariants?: Record<string, string[]>;

	/**
	 * Variant enforced on multi-page candidates per zone (typically default only).
	 */
	multiPageDefaultVariants?: Record<string, string>;

	// ── CSS class names (all have sensible defaults) ──────────────────────────

	/**
	 * Class added to cardId when layout resolves to a single page.
	 * @default 'blemmy-single-page'
	 */
	singlePageClass?: string;

	/**
	 * Prefix for density tier classes. The engine appends '1', '2', '3'.
	 * @default 'blemmy-density-'
	 */
	densityClassPrefix?: string;

	/**
	 * Prefix for fill tier classes. The engine appends '1', '2', '3'.
	 * @default 'blemmy-fill-'
	 */
	fillClassPrefix?: string;
}

// ─── Resolved spec ────────────────────────────────────────────────────────────

/**
 * EngineDocumentSpec with all optional CSS class fields resolved to defaults.
 * Used internally by the engine after calling resolveSpec().
 */
export interface ResolvedEngineDocumentSpec extends EngineDocumentSpec {
	singlePageClass:    string;
	densityClassPrefix: string;
	fillClassPrefix:    string;
}

export function resolveSpec(spec: EngineDocumentSpec): ResolvedEngineDocumentSpec {
	return {
		...spec,
		singlePageClass:    spec.singlePageClass    ?? 'blemmy-single-page',
		densityClassPrefix: spec.densityClassPrefix ?? 'blemmy-density-',
		fillClassPrefix:    spec.fillClassPrefix    ?? 'blemmy-fill-',
	};
}
