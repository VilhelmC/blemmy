/**
 * document-type-spec.ts
 *
 * Type contracts for Blemmy document type specifications.
 *
 * A DocumentTypeSpec is a JSON-serialisable description of a document type.
 * It is the grammar from which the layout engine derives its search space.
 * A RealisedLayout is a point in that grammar — the specific configuration
 * chosen by the search, sufficient to reproduce the layout without re-searching.
 *
 * Design principles:
 *   - A document is a single rectangular medium, recursively subdivided into zones
 *   - Page boundaries are outputs of layout, not inputs to the spec
 *   - The engine performs symbolic search over the spec's mutation space
 *   - A RealisedLayout records one value per mutation axis — loading it
 *     bypasses the search entirely
 *   - Density and fill are search hyperparameters, not layout geometry —
 *     they are not recorded in RealisedLayout
 *
 * Built-in specs:  src/data/doctypes/{docType}.doctype.json
 * Stored per-user: Supabase document_types table (future)
 */

// ─── Zone tree ────────────────────────────────────────────────────────────────

/**
 * A zone variant is a named discrete alternative for the internal arrangement
 * of a zone. The engine applies data-blemmy-variant="{id}" to the zone's DOM
 * element and measures the result — it does not know what the variant means
 * visually. The renderer responds to the attribute.
 *
 * Example: the CV header zone has variants 'full', 'compact', 'minimal', 'strip'
 * corresponding to how much space the header occupies and how its content
 * is distributed. These are rescue paths when page space is constrained.
 */
export interface ZoneVariant {
	id:       string;
	label?:   string;
	/** The variant applied when no RealisedLayout is present. */
	default?: boolean;
}

/**
 * How a zone's size is determined.
 *
 * fixed     — exact size in mm. Engine never changes it.
 * intrinsic — sizes to its content. Measured but not searched.
 * range     — engine searches for optimal value in [minMm, maxMm].
 *             This is a continuous mutation axis (e.g. sidebar width).
 * flex      — takes whatever space remains after siblings are sized.
 */
export type ZoneSizing =
	| { type: 'fixed'; mm: number }
	| { type: 'intrinsic' }
	| { type: 'range'; minMm: number; maxMm: number }
	| { type: 'flex' };

/**
 * A zone in the document medium.
 *
 * If `direction` and `children` are present: container zone.
 *   The zone subdivides along `direction`; `sizing` describes its own footprint.
 *
 * If neither `direction` nor `children`: leaf zone.
 *   The zone receives content directly. `variants` declares alternative
 *   internal arrangements the engine evaluates.
 *
 * DOM convention: {domPrefix}-zone-{id}
 * Example: cv prefix + sidebar id → element id "blemmy-zone-sidebar"
 */
export interface ZoneNode {
	/** Unique identifier within this spec. Used for DOM ID derivation. */
	id:           string;
	sizing:       ZoneSizing;

	// Container fields (mutually inclusive)
	direction?:   'horizontal' | 'vertical';
	children?:    ZoneNode[];

	// Leaf fields
	/** Discrete topology alternatives. Engine iterates and measures each. */
	variants?:    ZoneVariant[];
	/** Zone is only rendered on the first page of the document. */
	firstPageOnly?: boolean;
	/** Zone may be absent (e.g. footer when no sections are placed there). */
	optional?:    boolean;
}

// ─── Movable and fixed sections ───────────────────────────────────────────────

/**
 * A section the engine may assign to different zones.
 * This is a discrete mutation axis: engine searches over allowedZones.
 *
 * DOM convention: {domPrefix}-section-{id}
 */
export interface MovableSectionSpec {
	id:           string;
	label:        string;
	/** Zone the section occupies when no RealisedLayout is present. */
	defaultZone:  string;
	/** All zones this section may be assigned to. */
	allowedZones: string[];
}

/**
 * A section that always occupies a specific zone.
 * Profiled (width-sensitivity measured) to inform zone sizing,
 * but never moved by the engine.
 *
 * DOM convention: {domPrefix}-section-{id}
 */
export interface FixedSectionSpec {
	id:    string;
	label: string;
	zone:  string;
}

// ─── Content splits ───────────────────────────────────────────────────────────

/**
 * A repeating content collection whose split point across pages is searchable.
 * Engine searches over [minFirst, total-1] for the split index.
 *
 * Example: CV work entries — how many appear on page 1 vs page 2.
 */
export interface ContentSplitSpec {
	/** Logical identifier. */
	id:          string;
	/** Key in the content data object (e.g. 'work' for CVData.work). */
	collection:  string;
	/** Zone that receives the split content (usually 'main-body' or 'main'). */
	zone:        string;
	/** Minimum number of items that must appear before the split. Default 1. */
	minFirst?:   number;
}

// ─── Medium ───────────────────────────────────────────────────────────────────

/**
 * The physical medium the document is laid out on.
 * A document is a single continuous medium — page boundaries are outputs.
 */
export interface MediumSpec {
	pageSize:     'A4' | 'Letter' | 'A3';
	pages: {
		min: number;
		/** null = unconstrained (e.g. portfolio). */
		max: number | null;
	};
}

// ─── Root spec ────────────────────────────────────────────────────────────────

/**
 * The complete DocumentTypeSpec. JSON-serialisable.
 *
 * The spec is the grammar for the layout search. It declares:
 *   - The medium (page size, page count range)
 *   - The zone tree (recursive rectangle subdivision)
 *   - Movable sections (discrete assignment axes)
 *   - Fixed sections (profiled but not moved)
 *   - Content splits (page-split axes for repeating collections)
 *
 * The spec does NOT contain:
 *   - Content data (CVData, LetterData — separate JSON)
 *   - Style data (DocumentStyle — separate concern)
 *   - Search hyperparameters (density, fill — not geometry)
 */
export interface DocumentTypeSpec {
	/** Unique identifier. Used as doc_type in the database. */
	docType:      string;
	/** Human-readable name for the document type selector. */
	label:        string;
	/** Semantic version. Increment when the mutation space changes. */
	version:      string;
	/** TypeScript content type name (informational). */
	contentType:  string;
	/** DOM element ID prefix. Convention: {domPrefix}-zone-{zoneId}. */
	domPrefix:    string;

	medium:           MediumSpec;
	/** Root of the zone tree. Typically a vertical container. */
	zones:            ZoneNode;
	movableSections:  MovableSectionSpec[];
	fixedSections:    FixedSectionSpec[];
	contentSplits:    ContentSplitSpec[];
}

// ─── Realised layout ──────────────────────────────────────────────────────────

/**
 * A RealisedLayout is a point in the spec's mutation space — the specific
 * configuration chosen by the layout search. Storing it with the document
 * makes subsequent loads instant: apply the layout directly without searching.
 *
 * Every field corresponds to one axis in the spec's mutation space:
 *   pages             ← spec.medium.pages range
 *   zoneVariants      ← one entry per zone with variants[]
 *   zoneWidths        ← one entry per zone with sizing.type === 'range'
 *   sectionPlacements ← one entry per movableSections item
 *   contentSplits     ← one entry per contentSplits item
 *
 * Validation: a RealisedLayout is valid only if its values are within the
 * bounds declared by the spec it references. Invalid → re-search.
 *
 * NOT recorded here (search hyperparameters, not geometry):
 *   - density
 *   - fill
 */
export interface RealisedLayout {
	/** docType of the spec this layout was solved against. */
	docType:      string;
	/** spec.version at solve time. Version mismatch → re-search. */
	specVersion:  string;

	/** Number of pages in the realised layout. */
	pages:        number;

	/**
	 * Chosen variant for each zone that declared variants.
	 * Key = zone id, value = variant id.
	 * Absent entries use the variant with default: true.
	 */
	zoneVariants: Record<string, string>;

	/**
	 * Chosen width/height for each range-sized zone, in mm.
	 * Key = zone id, value = chosen mm value.
	 */
	zoneWidths:   Record<string, number>;

	/**
	 * Chosen zone for each movable section.
	 * Key = section id, value = zone id.
	 */
	sectionPlacements: Record<string, string>;

	/**
	 * Chosen split point for each content split.
	 * Key = split id, value = number of items before the split.
	 */
	contentSplits: Record<string, number>;
}

// ─── Zone tree utilities ──────────────────────────────────────────────────────

/**
 * Derives the DOM element ID for a zone using the convention.
 * {domPrefix}-zone-{zoneId}
 */
export function zoneElementId(domPrefix: string, zoneId: string): string {
	return `${domPrefix}-zone-${zoneId}`;
}

/**
 * Derives the DOM element ID for a section using the convention.
 * {domPrefix}-section-{sectionId}
 */
export function sectionElementId(domPrefix: string, sectionId: string): string {
	return `${domPrefix}-section-${sectionId}`;
}

/**
 * Walks the zone tree and returns all zones matching the predicate.
 */
export function findZones(
	root:      ZoneNode,
	predicate: (z: ZoneNode) => boolean,
): ZoneNode[] {
	const results: ZoneNode[] = [];
	function walk(z: ZoneNode): void {
		if (predicate(z)) { results.push(z); }
		if (z.children) { z.children.forEach(walk); }
	}
	walk(root);
	return results;
}

/**
 * Returns all leaf zones (no children) in tree order.
 */
export function leafZones(root: ZoneNode): ZoneNode[] {
	return findZones(root, (z) => !z.children || z.children.length === 0);
}

/**
 * Returns all zones with variants declared (topology search axes).
 */
export function variantZones(root: ZoneNode): ZoneNode[] {
	return findZones(root, (z) => Boolean(z.variants?.length));
}

/**
 * Returns all zones with range sizing (continuous search axes).
 */
export function rangeZones(root: ZoneNode): ZoneNode[] {
	return findZones(root, (z) => z.sizing.type === 'range');
}

/**
 * Returns the default variant id for a zone, or null if no variants.
 */
export function defaultVariant(zone: ZoneNode): string | null {
	if (!zone.variants?.length) { return null; }
	return zone.variants.find((v) => v.default)?.id ?? zone.variants[0].id;
}

/**
 * Validates a RealisedLayout against a DocumentTypeSpec.
 * Returns null if valid, or a reason string if invalid.
 * Invalid layouts cause the engine to re-run the search.
 */
export function validateRealisedLayout(
	layout: RealisedLayout,
	spec:   DocumentTypeSpec,
): string | null {
	if (layout.docType !== spec.docType) {
		return `docType mismatch: layout has "${layout.docType}", spec has "${spec.docType}"`;
	}
	if (layout.specVersion !== spec.version) {
		return `specVersion mismatch: layout has "${layout.specVersion}", spec has "${spec.version}"`;
	}
	const { min, max } = spec.medium.pages;
	if (layout.pages < min || (max !== null && layout.pages > max)) {
		return `pages ${layout.pages} outside spec range [${min}, ${max ?? '∞'}]`;
	}
	// Validate range zones
	for (const rz of rangeZones(spec.zones)) {
		const sizing = rz.sizing as { type: 'range'; minMm: number; maxMm: number };
		const val    = layout.zoneWidths[rz.id];
		if (val === undefined) { continue; } // absent → engine will use default
		if (val < sizing.minMm || val > sizing.maxMm) {
			return `zone "${rz.id}" width ${val}mm outside range [${sizing.minMm}, ${sizing.maxMm}]`;
		}
	}
	// Validate section placements
	for (const sec of spec.movableSections) {
		const placement = layout.sectionPlacements[sec.id];
		if (placement && !sec.allowedZones.includes(placement)) {
			return `section "${sec.id}" placed in "${placement}" which is not in allowedZones`;
		}
	}
	return null;
}
