/**
 * document-type.ts
 *
 * Runtime document type management.
 *
 * Responsibilities:
 *   - Registry of loaded DocumentTypeSpec objects
 *   - deriveEngineSpec(): DocumentTypeSpec → EngineDocumentSpec
 *   - Validation and type guards
 *   - JSON comparison utilities
 *
 * The three built-in specs are imported directly from src/data/doctypes/.
 * User-modified or cloud-stored specs can be registered at runtime.
 */

import type { DocumentTypeSpec, SectionSpec } from '../types/document-type-spec';
import { deriveDomId, deriveSectionDomId } from '../types/document-type-spec';
import type { EngineDocumentSpec } from '@lib/engine/document-spec';

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { DocumentTypeSpec, SectionSpec, LayoutModel, SectionPlacement }
	from '../types/document-type-spec';

// ─── Built-in spec imports ────────────────────────────────────────────────────

import cvSpec          from '@data/doctypes/cv.doctype.json';
import letterSpec      from '@data/doctypes/letter.doctype.json';
import portfolioSpec   from '@data/doctypes/portfolio.doctype.json';

// ─── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, DocumentTypeSpec>([
	['cv',        cvSpec        as DocumentTypeSpec],
	['letter',    letterSpec    as DocumentTypeSpec],
	['portfolio', portfolioSpec as DocumentTypeSpec],
]);

/**
 * Returns all registered document type specs, in registration order.
 */
export function listDocTypes(): DocumentTypeSpec[] {
	return Array.from(registry.values());
}

/**
 * Returns the spec for a given docType, or null if not found.
 */
export function getDocTypeSpec(docType: string): DocumentTypeSpec | null {
	return registry.get(docType) ?? null;
}

/**
 * Registers a custom or user-uploaded DocumentTypeSpec.
 * Overwrites any existing registration for the same docType.
 * Validates the spec before registering.
 */
export function registerDocTypeSpec(spec: DocumentTypeSpec): void {
	const err = validateDocTypeSpec(spec);
	if (err) { throw new Error(`Invalid DocumentTypeSpec: ${err}`); }
	registry.set(spec.docType, spec);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates a DocumentTypeSpec JSON object.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateDocTypeSpec(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object') { return 'spec must be an object'; }
	const s = raw as Record<string, unknown>;

	if (typeof s.docType !== 'string' || !s.docType)
		{ return '"docType" must be a non-empty string'; }
	if (typeof s.label !== 'string' || !s.label)
		{ return '"label" must be a non-empty string'; }
	if (typeof s.version !== 'string')
		{ return '"version" must be a string'; }
	if (!s.layout || typeof s.layout !== 'object')
		{ return '"layout" must be an object'; }
	if (typeof s.domPrefix !== 'string' || !s.domPrefix)
		{ return '"domPrefix" must be a non-empty string'; }
	if (!Array.isArray(s.sections))
		{ return '"sections" must be an array'; }

	const layout = s.layout as Record<string, unknown>;
	const validModels = ['sidebar-main', 'single-column', 'multi-page'];
	if (!validModels.includes(layout.model as string))
		{ return `"layout.model" must be one of: ${validModels.join(', ')}`; }

	for (const [i, sec] of (s.sections as unknown[]).entries()) {
		if (!sec || typeof sec !== 'object') { return `sections[${i}] must be an object`; }
		const section = sec as Record<string, unknown>;
		if (typeof section.id !== 'string' || !section.id)
			{ return `sections[${i}].id must be a non-empty string`; }
		if (typeof section.label !== 'string')
			{ return `sections[${i}].label must be a string`; }
		const validPlacements = ['fixed-main','fixed-sidebar','movable','masthead','profilable'];
		if (!validPlacements.includes(section.placement as string))
			{ return `sections[${i}].placement must be one of: ${validPlacements.join(', ')}`; }
	}

	return null;
}

/**
 * Type guard: returns true if raw is a valid DocumentTypeSpec.
 */
export function isDocTypeSpec(raw: unknown): raw is DocumentTypeSpec {
	return validateDocTypeSpec(raw) === null;
}

// ─── Engine spec derivation ───────────────────────────────────────────────────

/**
 * Derives an EngineDocumentSpec from a DocumentTypeSpec.
 *
 * For sidebar-main documents: returns a full EngineDocumentSpec suitable
 * for passing to initCvLayoutEngine().
 *
 * For single-column and multi-page documents: returns a minimal spec with
 * empty movableSections and alwaysSidebarIds. The full candidate-search
 * pipeline is not invoked for these layout models — only fill and slack
 * apply. The calling code should check spec.layout.model before invoking
 * the engine.
 *
 * DOM IDs are derived by convention from domPrefix, with overrides applied
 * for backward compatibility (e.g. 'cv' uses 'cv-rebalance-skills' instead
 * of the derived 'cv-section-skills').
 */
export function deriveEngineSpec(spec: DocumentTypeSpec): EngineDocumentSpec {
	const ov = spec.domOverrides ?? {};
	const css = spec.cssClasses ?? {};

	// ── Movable sections (sidebar-main only) ──────────────────────────────────
	const movableSections: Record<string, string> = {};
	if (spec.layout.model === 'sidebar-main') {
		for (const sec of spec.sections) {
			if (sec.placement === 'movable') {
				movableSections[sec.id] = deriveSectionDomId(sec.id, spec.domPrefix, ov);
			}
		}
	}

	// ── Always-sidebar section IDs ────────────────────────────────────────────
	const alwaysSidebarIds: string[] = [];
	if (spec.layout.model === 'sidebar-main') {
		for (const sec of spec.sections) {
			if (sec.placement === 'fixed-sidebar') {
				alwaysSidebarIds.push(deriveSectionDomId(sec.id, spec.domPrefix, ov));
			}
		}
	}

	// ── Profilable section IDs ────────────────────────────────────────────────
	const profilableIds: string[] = [];
	if (spec.layout.model === 'sidebar-main') {
		for (const sec of spec.sections) {
			if (sec.placement === 'profilable') {
				profilableIds.push(deriveSectionDomId(sec.id, spec.domPrefix, ov));
			}
		}
	}

	// ── Structural element IDs ────────────────────────────────────────────────
	return {
		cardId:     deriveDomId('card',     spec.domPrefix, ov),
		shellId:    deriveDomId('shell',    spec.domPrefix, ov),
		page1Id:    deriveDomId('page1',    spec.domPrefix, ov),
		page2Id:    deriveDomId('page2',    spec.domPrefix, ov),
		sidebar1Id: deriveDomId('sidebar1', spec.domPrefix, ov),
		sidebar2Id: deriveDomId('sidebar2', spec.domPrefix, ov),
		main1Id:    deriveDomId('main1',    spec.domPrefix, ov),
		main2Id:    deriveDomId('main2',    spec.domPrefix, ov),

		statusElId:      deriveDomId('statusEl',      spec.domPrefix, ov) || undefined,
		footer1Id:       spec.layout.hasFooter
			? deriveDomId('footer1', spec.domPrefix, ov) || undefined
			: undefined,
		footer2Id:       spec.layout.hasFooter && (spec.layout.maxPages ?? 1) > 1
			? deriveDomId('footer2', spec.domPrefix, ov) || undefined
			: undefined,
		mastheadId:      spec.layout.hasMasthead
			? deriveDomId('masthead', spec.domPrefix, ov) || undefined
			: undefined,
		portraitCellId:  spec.layout.hasPortrait
			? deriveDomId('portraitCell', spec.domPrefix, ov) || undefined
			: undefined,
		mastheadRightId: spec.layout.hasMasthead
			? deriveDomId('mastheadRight', spec.domPrefix, ov) || undefined
			: undefined,
		profileColId:    spec.layout.hasMasthead
			? deriveDomId('profileCol', spec.domPrefix, ov) || undefined
			: undefined,

		movableSections,
		alwaysSidebarIds,
		profilableIds:   profilableIds.length > 0 ? profilableIds : undefined,

		singlePageClass:    css.singlePage     ?? `${spec.domPrefix}-single-page`,
		densityClassPrefix: css.densityPrefix  ?? `${spec.domPrefix}-density-`,
		fillClassPrefix:    css.fillPrefix     ?? `${spec.domPrefix}-fill-`,
	};
}

// ─── Comparison utilities ─────────────────────────────────────────────────────

/**
 * Returns true if two DocumentTypeSpec objects are structurally identical
 * (same sections, same layout model, same DOM wiring).
 * Version and label differences are ignored.
 */
export function specsAreEquivalent(a: DocumentTypeSpec, b: DocumentTypeSpec): boolean {
	if (a.docType !== b.docType) { return false; }
	if (a.layout.model !== b.layout.model) { return false; }
	if (a.layout.maxPages !== b.layout.maxPages) { return false; }
	if (a.sections.length !== b.sections.length) { return false; }
	for (let i = 0; i < a.sections.length; i++) {
		const sa = a.sections[i];
		const sb = b.sections[i];
		if (sa.id !== sb.id || sa.placement !== sb.placement) { return false; }
	}
	return true;
}

/**
 * Returns a human-readable diff summary between two specs.
 * Useful for assistant responses when a user changes their document type.
 */
export function specDiffSummary(a: DocumentTypeSpec, b: DocumentTypeSpec): string[] {
	const diffs: string[] = [];

	if (a.layout.model !== b.layout.model) {
		diffs.push(`Layout model: ${a.layout.model} → ${b.layout.model}`);
	}
	if (a.layout.maxPages !== b.layout.maxPages) {
		diffs.push(`Max pages: ${a.layout.maxPages ?? '∞'} → ${b.layout.maxPages ?? '∞'}`);
	}

	const aIds = new Set(a.sections.map(s => s.id));
	const bIds = new Set(b.sections.map(s => s.id));

	for (const id of aIds) {
		if (!bIds.has(id)) { diffs.push(`Section removed: ${id}`); }
	}
	for (const id of bIds) {
		if (!aIds.has(id)) { diffs.push(`Section added: ${id}`); }
	}

	for (const sa of a.sections) {
		const sb = b.sections.find(s => s.id === sa.id);
		if (sb && sa.placement !== sb.placement) {
			diffs.push(`Section ${sa.id}: ${sa.placement} → ${sb.placement}`);
		}
	}

	return diffs;
}

// ─── System prompt helper ─────────────────────────────────────────────────────

/**
 * Returns a brief description of a DocumentTypeSpec for injection into
 * the AI assistant system prompt.
 */
export function describeDocTypeSpec(spec: DocumentTypeSpec): string {
	const movable = spec.sections.filter(s => s.placement === 'movable').map(s => s.id);
	const fixed   = spec.sections.filter(s => s.placement === 'fixed-main').map(s => s.id);
	const lines   = [
		`Document type: ${spec.label} (${spec.docType})`,
		`Layout: ${spec.layout.model}, max ${spec.layout.maxPages ?? '∞'} pages`,
	];
	if (fixed.length)   { lines.push(`Fixed sections: ${fixed.join(', ')}`); }
	if (movable.length) { lines.push(`Movable sections: ${movable.join(', ')}`); }
	return lines.join('\n');
}
