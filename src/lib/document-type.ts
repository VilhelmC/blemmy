/**
 * document-type.ts
 *
 * Runtime document type management: registry, validation, engine bridge.
 * Zone-tree DocumentTypeSpec → EngineDocumentSpec (legacy DOM IDs for cv/letter).
 */

import type {
	DocumentTypeSpec,
	MovableSectionSpec,
	FixedSectionSpec,
	ContentSplitSpec,
	ZoneNode,
	ZoneSizing,
	RealisedLayout,
} from '@cv/document-type-spec';
import {
	zoneElementId,
	sectionElementId,
	findZones,
	rangeZones,
	variantZones,
	defaultVariant,
	validateRealisedLayout,
} from '@cv/document-type-spec';
import type { EngineDocumentSpec } from '@lib/engine/document-spec';

export type {
	DocumentTypeSpec,
	MovableSectionSpec,
	FixedSectionSpec,
	ContentSplitSpec,
	ZoneNode,
	ZoneSizing,
	RealisedLayout,
};
export {
	zoneElementId,
	sectionElementId,
	findZones,
	rangeZones,
	variantZones,
	defaultVariant,
	validateRealisedLayout,
};

import cvSpec        from '@data/doctypes/cv.doctype.json';
import letterSpec    from '@data/doctypes/letter.doctype.json';
import portfolioSpec from '@data/doctypes/portfolio.doctype.json';

const registry = new Map<string, DocumentTypeSpec>([
	['cv',        cvSpec        as unknown as DocumentTypeSpec],
	['letter',    letterSpec    as unknown as DocumentTypeSpec],
	['portfolio', portfolioSpec as unknown as DocumentTypeSpec],
]);

export function listDocTypes(): DocumentTypeSpec[] {
	return Array.from(registry.values());
}

export function getDocTypeSpec(docType: string): DocumentTypeSpec | null {
	return registry.get(docType) ?? null;
}

export function registerDocTypeSpec(spec: DocumentTypeSpec): void {
	const err = validateDocTypeSpec(spec);
	if (err) { throw new Error(`Invalid DocumentTypeSpec: ${err}`); }
	registry.set(spec.docType, spec);
}

export function validateDocTypeSpec(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object') { return 'spec must be an object'; }
	const s = raw as Record<string, unknown>;

	if (typeof s.docType !== 'string' || !s.docType)
		{ return '"docType" must be a non-empty string'; }
	if (typeof s.label !== 'string' || !s.label)
		{ return '"label" must be a non-empty string'; }
	if (typeof s.version !== 'string')
		{ return '"version" must be a string'; }
	if (typeof s.domPrefix !== 'string' || !s.domPrefix)
		{ return '"domPrefix" must be a non-empty string'; }
	if (!s.medium || typeof s.medium !== 'object')
		{ return '"medium" must be an object'; }
	if (!s.zones || typeof s.zones !== 'object')
		{ return '"zones" must be an object (zone tree root)'; }
	if (!Array.isArray(s.movableSections))
		{ return '"movableSections" must be an array'; }
	if (!Array.isArray(s.fixedSections))
		{ return '"fixedSections" must be an array'; }
	if (!Array.isArray(s.contentSplits))
		{ return '"contentSplits" must be an array'; }

	return null;
}

export function isDocTypeSpec(raw: unknown): raw is DocumentTypeSpec {
	return validateDocTypeSpec(raw) === null;
}

/** Engine wiring matching the shipped CV renderer (pre-{prefix}-zone-* IDs). */
const CV_LEGACY_ENGINE_SPEC: EngineDocumentSpec = {
	cardId:     'cv-card',
	shellId:    'cv-shell',
	page1Id:    'cv-page-1',
	page2Id:    'cv-page-2',
	sidebar1Id: 'cv-sidebar-1',
	sidebar2Id: 'cv-sidebar-2',
	main1Id:    'cv-main-1',
	main2Id:    'cv-main-2',

	statusElId:      'cv-layout-status',
	footer1Id:       'cv-page-1-body-footer',
	footer2Id:       'cv-page-2-body-footer',
	mastheadId:      'cv-page-1-masthead',
	portraitCellId:  'cv-p1-portrait-cell',
	mastheadRightId: 'cv-masthead-right',
	profileColId:    'cv-masthead-profile-col',

	movableSections: {
		skills:    'cv-rebalance-skills',
		languages: 'cv-rebalance-languages',
		interests: 'cv-rebalance-interests',
	},
	alwaysSidebarIds: ['cv-education'],
	profilableIds:    ['cv-rebalance-profile'],

	singlePageClass:    'cv-single-page',
	densityClassPrefix: 'cv-density-',
	fillClassPrefix:    'cv-fill-',
};

const LETTER_LEGACY_ENGINE_SPEC: EngineDocumentSpec = {
	cardId:     'letter-card',
	shellId:    'letter-shell',
	page1Id:    'letter-page-1',
	page2Id:    'letter-page-2',
	sidebar1Id: 'letter-sidebar-1',
	sidebar2Id: 'letter-sidebar-2',
	main1Id:    'letter-main-1',
	main2Id:    'letter-main-2',

	statusElId: 'letter-layout-status',

	movableSections:  {},
	alwaysSidebarIds: [],

	singlePageClass:    'letter-single-page',
	densityClassPrefix: 'letter-density-',
	fillClassPrefix:    'letter-fill-',
};

/**
 * Derives EngineDocumentSpec from zone-tree JSON.
 * Used for types without a frozen legacy DOM (e.g. portfolio stub).
 */
function deriveEngineSpecFromZones(spec: DocumentTypeSpec): EngineDocumentSpec {
	const p = spec.domPrefix;

	const sidebarZone  = findZoneById(spec.zones, 'sidebar');
	const mainBodyZone = findZoneById(spec.zones, 'main-body') ??
		findZoneById(spec.zones, 'main') ??
		findZoneById(spec.zones, 'body');
	const headerZone   = findZoneById(spec.zones, 'header');
	const footerZone   = findZoneById(spec.zones, 'footer');

	const movableSections: Record<string, string> = {};
	for (const sec of spec.movableSections) {
		movableSections[sec.id] = sectionElementId(p, sec.id);
	}

	const alwaysSidebarIds: string[] = spec.fixedSections
		.filter((s) => s.zone === 'sidebar')
		.map((s) => sectionElementId(p, s.id));

	const profilableIds: string[] = spec.fixedSections
		.filter((s) => s.zone === 'header' || s.zone === 'main-body')
		.map((s) => sectionElementId(p, s.id));

	const sidebarId = sidebarZone ? zoneElementId(p, sidebarZone.id) : `${p}-zone-sidebar`;
	const mainId    = mainBodyZone ? zoneElementId(p, mainBodyZone.id) : `${p}-zone-main-body`;
	const footerId  = footerZone ? zoneElementId(p, footerZone.id) : undefined;
	const headerId  = headerZone ? zoneElementId(p, headerZone.id) : undefined;

	return {
		cardId:     `${p}-card`,
		shellId:    `${p}-shell`,
		page1Id:    `${p}-page-1`,
		page2Id:    `${p}-page-2`,
		sidebar1Id: sidebarId,
		sidebar2Id: sidebarId,
		main1Id:    mainId,
		main2Id:    mainId,

		statusElId:      `${p}-layout-status`,
		footer1Id:       footerId,
		footer2Id:       footerId,
		mastheadId:      headerId,
		portraitCellId:  spec.fixedSections.some((s) => s.id === 'portrait')
			? sectionElementId(p, 'portrait')
			: undefined,
		mastheadRightId: `${p}-zone-header-right`,
		profileColId:    `${p}-zone-header-profile`,

		movableSections,
		alwaysSidebarIds,
		profilableIds: profilableIds.length > 0 ? profilableIds : undefined,

		singlePageClass:    `${p}-single-page`,
		densityClassPrefix: `${p}-density-`,
		fillClassPrefix:    `${p}-fill-`,
	};
}

function findZoneById(root: ZoneNode, id: string): ZoneNode | null {
	if (root.id === id) { return root; }
	if (!root.children) { return null; }
	for (const child of root.children) {
		const found = findZoneById(child, id);
		if (found) { return found; }
	}
	return null;
}

export function deriveEngineSpec(spec: DocumentTypeSpec): EngineDocumentSpec {
	if (spec.docType === 'cv') { return CV_LEGACY_ENGINE_SPEC; }
	if (spec.docType === 'letter') { return LETTER_LEGACY_ENGINE_SPEC; }
	return deriveEngineSpecFromZones(spec);
}

export function describeMutationSpace(spec: DocumentTypeSpec): string[] {
	const lines: string[] = [];
	const p = spec.medium.pages;
	lines.push(`Pages: ${p.min}–${p.max ?? '∞'}`);
	for (const rz of rangeZones(spec.zones)) {
		const s = rz.sizing as { type: 'range'; minMm: number; maxMm: number };
		lines.push(`Zone "${rz.id}" width: ${s.minMm}–${s.maxMm}mm (continuous)`);
	}
	for (const vz of variantZones(spec.zones)) {
		const ids = (vz.variants ?? []).map((v) => v.id).join(', ');
		lines.push(`Zone "${vz.id}" topology: [${ids}]`);
	}
	for (const sec of spec.movableSections) {
		lines.push(
			`Section "${sec.id}": [${sec.allowedZones.join(', ')}] (default: ${sec.defaultZone})`,
		);
	}
	for (const cs of spec.contentSplits) {
		lines.push(`Content split "${cs.id}" (${cs.collection}): min ${cs.minFirst ?? 1} on first page`);
	}
	return lines;
}

export function specsAreEquivalent(a: DocumentTypeSpec, b: DocumentTypeSpec): boolean {
	if (a.docType !== b.docType) { return false; }
	if (a.medium.pageSize !== b.medium.pageSize) { return false; }
	if (a.movableSections.length !== b.movableSections.length) { return false; }
	for (let i = 0; i < a.movableSections.length; i++) {
		const sa = a.movableSections[i];
		const sb = b.movableSections[i];
		if (sa.id !== sb.id || sa.defaultZone !== sb.defaultZone) { return false; }
	}
	return true;
}

export function specDiffSummary(a: DocumentTypeSpec, b: DocumentTypeSpec): string[] {
	const diffs: string[] = [];
	if (a.medium.pageSize !== b.medium.pageSize) {
		diffs.push(`Page size: ${a.medium.pageSize} → ${b.medium.pageSize}`);
	}
	if (a.medium.pages.max !== b.medium.pages.max) {
		diffs.push(`Max pages: ${a.medium.pages.max ?? '∞'} → ${b.medium.pages.max ?? '∞'}`);
	}
	const aSecIds = new Set(a.movableSections.map((s) => s.id));
	const bSecIds = new Set(b.movableSections.map((s) => s.id));
	for (const id of aSecIds) {
		if (!bSecIds.has(id)) { diffs.push(`Section removed: ${id}`); }
	}
	for (const id of bSecIds) {
		if (!aSecIds.has(id)) { diffs.push(`Section added: ${id}`); }
	}
	for (const sa of a.movableSections) {
		const sb = b.movableSections.find((s) => s.id === sa.id);
		if (sb && sa.defaultZone !== sb.defaultZone) {
			diffs.push(`Section "${sa.id}" default: ${sa.defaultZone} → ${sb.defaultZone}`);
		}
	}
	return diffs;
}

export function describeDocTypeSpec(spec: DocumentTypeSpec): string {
	const lines = [
		`Document type: ${spec.label} (${spec.docType})`,
		`Medium: ${spec.medium.pageSize}, ${spec.medium.pages.min}–${spec.medium.pages.max ?? '∞'} pages`,
		...describeMutationSpace(spec),
	];
	return lines.join('\n');
}
