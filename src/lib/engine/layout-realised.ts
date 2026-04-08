/**
 * layout-realised.ts
 *
 * Generic realised layout — capture and apply for any document type.
 *
 * NOTE: migrateSnapshot() maps stored CVLayoutSnapshot-shaped payloads into
 * RealisedLayout. Live DOM and datasets use the blemmy vocabulary only.
 */

import type { DocumentTypeSpec, RealisedLayout } from '@cv/document-type-spec';
import {
	zoneElementId,
	sectionElementId,
	rangeZones,
	variantZones,
	defaultVariant,
	validateRealisedLayout,
} from '@cv/document-type-spec';

// ─── CV legacy DOM (renderer still uses pre-zone IDs) ───────────────────────

const CV_SECTION_ELEMENT_IDS: Record<string, string> = {
	skills:    'blemmy-rebalance-skills',
	languages: 'blemmy-rebalance-languages',
	interests: 'blemmy-rebalance-interests',
	profile:   'blemmy-rebalance-profile',
	education: 'blemmy-education',
};

function resolveSectionElementId(
	docType: string,
	domPrefix: string,
	sectionId: string,
): string {
	if (docType === 'cv' && CV_SECTION_ELEMENT_IDS[sectionId]) {
		return CV_SECTION_ELEMENT_IDS[sectionId];
	}
	return sectionElementId(domPrefix, sectionId);
}

function legacyVariantZoneEl(
	docType: string,
	domPrefix: string,
	zoneId: string,
): HTMLElement | null {
	if (docType === 'cv' && zoneId === 'header') {
		return document.getElementById('blemmy-zone-header')
			?? document.getElementById('blemmy-page-1-masthead');
	}
	return document.getElementById(zoneElementId(domPrefix, zoneId));
}

function legacyZoneHostEl(docType: string, domPrefix: string, zoneId: string): HTMLElement | null {
	if (docType !== 'cv') {
		return document.getElementById(zoneElementId(domPrefix, zoneId));
	}
	switch (zoneId) {
		case 'sidebar':
			return document.getElementById('blemmy-sidebar-1');
		case 'footer':
			return document.getElementById('blemmy-page-1-body-footer');
		case 'main-body':
			return document.getElementById('blemmy-main-1');
		case 'header':
			return document.getElementById('blemmy-page-1-masthead');
		default:
			return document.getElementById(zoneElementId(domPrefix, zoneId));
	}
}

// ─── Capture ──────────────────────────────────────────────────────────────────

/**
 * Reads the current DOM state for a spec and returns a RealisedLayout.
 */
export function captureRealisedLayout(spec: DocumentTypeSpec): RealisedLayout | null {
	const card = document.getElementById(`${spec.domPrefix}-card`);
	if (!(card instanceof HTMLElement)) { return null; }

	const pagesRaw = card.dataset.blemmyLayoutPages ?? card.dataset.blemmyPages;
	const pages = pagesRaw ? parseInt(pagesRaw, 10) : 1;

	const zoneWidths: Record<string, number> = {};
	for (const rz of rangeZones(spec.zones)) {
		const cssVar = `--blemmy-zone-${rz.id}-mm`;
		const raw    = card.style.getPropertyValue(cssVar).trim() ||
			(rz.id === 'sidebar'
				? card.style.getPropertyValue('--blemmy-sidebar-width-override').trim()
				: '');
		const mm = parseFloat(raw.replace('mm', ''));
		if (Number.isFinite(mm)) { zoneWidths[rz.id] = mm; }
	}

	const zoneVariants: Record<string, string> = {};
	for (const vz of variantZones(spec.zones)) {
		const attrKey = `blemmyVariant${capitalize(vz.id)}`;
		const val     = (card.dataset as Record<string, string | undefined>)[attrKey] ??
			(vz.id === 'header'
				? card.dataset.blemmyLayoutHeaderVariant
				: undefined);
		if (val) { zoneVariants[vz.id] = val; }
	}

	const sectionPlacements: Record<string, string> = {};
	for (const sec of spec.movableSections) {
		const attrKey = `blemmySection${capitalize(sec.id)}`;
		const val     = (card.dataset as Record<string, string | undefined>)[attrKey];
		if (val) {
			sectionPlacements[sec.id] = val;
		} else {
			const legacySections = readLegacySections(card);
			if (legacySections?.[sec.id]) {
				const legacyVal = legacySections[sec.id];
				sectionPlacements[sec.id] =
					legacyVal === 'sidebar'    ? 'sidebar' :
					legacyVal === 'p1-footer'  ? 'footer'  :
					legacyVal === 'p2-footer'  ? 'footer'  :
					sec.defaultZone;
			}
		}
	}

	const contentSplits: Record<string, number> = {};
	for (const cs of spec.contentSplits) {
		const attrKey = `blemmySplit${capitalize(cs.id)}`;
		const val     = (card.dataset as Record<string, string | undefined>)[attrKey] ??
			(cs.id === 'work' ? card.dataset.cvSplit : undefined);
		if (val !== undefined) {
			const n = parseInt(val, 10);
			if (Number.isFinite(n) && n >= 0) { contentSplits[cs.id] = n; }
		}
	}

	return {
		docType:     spec.docType,
		specVersion: spec.version,
		pages,
		zoneVariants,
		zoneWidths,
		sectionPlacements,
		contentSplits,
	};
}

// ─── Apply ────────────────────────────────────────────────────────────────────

export function applyRealisedLayout(
	layout: RealisedLayout,
	spec:   DocumentTypeSpec,
): boolean {
	const invalid = validateRealisedLayout(layout, spec);
	if (invalid) {
		console.warn(`[layout-realised] Invalid layout: ${invalid} — search will run`);
		return false;
	}

	const p    = spec.domPrefix;
	const card = document.getElementById(`${p}-card`);
	if (!(card instanceof HTMLElement)) { return false; }

	const isSinglePage = layout.pages === 1;
	card.classList.toggle(`${p}-single-page`, isSinglePage);
	card.dataset.blemmyPages = String(layout.pages);
	card.dataset.blemmyLayoutPages = String(layout.pages);
	card.dataset.blemmyLayoutDisposition = isSinglePage ? 'single-page' : 'two-page';

	const page2 = document.getElementById(`${p}-page-2`);
	if (page2 instanceof HTMLElement) {
		page2.style.display = isSinglePage ? 'none' : '';
	}

	for (const rz of rangeZones(spec.zones)) {
		const mm = layout.zoneWidths[rz.id];
		if (mm === undefined) { continue; }
		card.style.setProperty(`--blemmy-zone-${rz.id}-mm`, `${mm}mm`);
		if (rz.id === 'sidebar') {
			card.style.setProperty('--blemmy-sidebar-width-override', `${mm}mm`);
			card.dataset.blemmyLayoutSidebarMm = String(Math.round(mm));
		}
	}

	for (const vz of variantZones(spec.zones)) {
		const variantId = layout.zoneVariants[vz.id] ?? defaultVariant(vz) ?? '';
		const zoneEl    = legacyVariantZoneEl(spec.docType, p, vz.id);
		if (zoneEl instanceof HTMLElement) {
			zoneEl.dataset.blemmyVariant = variantId;
		}
		const attrKey = `blemmyVariant${capitalize(vz.id)}`;
		(card.dataset as Record<string, string>)[attrKey] = variantId;
		if (vz.id === 'header') {
			card.dataset.blemmyLayoutHeaderVariant = variantId;
			applyLegacyMastheadMode(variantId, spec.docType);
		}
	}

	for (const sec of spec.movableSections) {
		const zoneId = layout.sectionPlacements[sec.id] ?? sec.defaultZone;
		const secEl  = document.getElementById(
			resolveSectionElementId(spec.docType, p, sec.id),
		);
		const targetEl = legacyZoneHostEl(spec.docType, p, zoneId);
		if (secEl instanceof HTMLElement && targetEl instanceof HTMLElement) {
			targetEl.appendChild(secEl);
		}
		const attrKey = `blemmySection${capitalize(sec.id)}`;
		(card.dataset as Record<string, string>)[attrKey] = zoneId;
	}

	for (const cs of spec.contentSplits) {
		const splitAt = layout.contentSplits[cs.id];
		if (splitAt === undefined) { continue; }
		const attrKey = `blemmySplit${capitalize(cs.id)}`;
		(card.dataset as Record<string, string>)[attrKey] = String(splitAt);
		if (cs.id === 'work') {
			card.dataset.blemmyLayoutWorkSplit = String(splitAt);
			applyLegacyWorkSplit(splitAt, spec.docType);
		}
	}

	card.setAttribute('data-blemmy-layout-ready', 'true');
	window.dispatchEvent(new Event('blemmy-layout-applied'));
	return true;
}

// ─── Document data utilities ──────────────────────────────────────────────────

export function withRealisedLayout<T extends Record<string, unknown>>(
	data: T,
	spec: DocumentTypeSpec,
): T {
	const layout = captureRealisedLayout(spec);
	if (!layout) { return data; }
	return { ...data, realisedLayout: layout };
}

export function migrateSnapshot(
	snapshot: {
		pages:          1 | 2;
		mastheadMode:   string;
		sections:       Record<string, string>;
		pageSplitWork:  number;
		sidebarMm:      number;
		density:        number;
		fill:           number;
		p1FooterCols:   number;
		p2FooterCols:   number;
	},
	spec: DocumentTypeSpec,
): RealisedLayout {
	const sectionPlacements: Record<string, string> = {};
	for (const [id, legacyZone] of Object.entries(snapshot.sections)) {
		sectionPlacements[id] =
			legacyZone === 'sidebar'   ? 'sidebar' :
			legacyZone.endsWith('footer') ? 'footer' :
			'sidebar';
	}

	return {
		docType:       spec.docType,
		specVersion:   spec.version,
		pages:         snapshot.pages,
		zoneVariants:  { header: snapshot.mastheadMode ?? 'full' },
		zoneWidths:    { sidebar: snapshot.sidebarMm },
		sectionPlacements,
		contentSplits: { work: snapshot.pageSplitWork },
	};
}

function capitalize(s: string): string {
	return s.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function readLegacySections(card: HTMLElement): Record<string, string> | null {
	const raw = card.dataset.blemmyLayoutSections;
	if (!raw) { return null; }
	try { return JSON.parse(raw) as Record<string, string>; }
	catch { return null; }
}

function applyLegacyMastheadMode(mode: string, docType: string): void {
	if (docType !== 'cv') { return; }
	const masthead    = document.getElementById('blemmy-zone-header') ??
		document.getElementById('blemmy-page-1-masthead');
	const profileCol  = document.getElementById('blemmy-zone-header-profile') ??
		document.getElementById('blemmy-masthead-profile-col');
	const profile     = document.getElementById('blemmy-section-profile') ??
		document.getElementById('blemmy-rebalance-profile');
	const mastheadRight = document.getElementById('blemmy-zone-header-right') ??
		document.getElementById('blemmy-masthead-right');
	const main1       = document.getElementById('blemmy-zone-main-body') ??
		document.getElementById('blemmy-main-1');

	if (!masthead) { return; }
	masthead.classList.remove('blemmy-masthead-collapsed');

	if (profile && profileCol && !profileCol.contains(profile)) {
		profileCol.appendChild(profile);
	}
	if (mastheadRight && masthead && !masthead.contains(mastheadRight)) {
		masthead.prepend(mastheadRight);
	}

	if (mode === 'compact' || mode === 'profile-sidebar-meta') {
		const hb = masthead.querySelector('.blemmy-header-block');
		if (hb && mastheadRight) { hb.appendChild(mastheadRight); }
		return;
	}
	if (mode === 'minimal' || mode === 'profile-main') {
		if (profile && main1) { main1.insertBefore(profile, main1.firstChild); }
		return;
	}
	if (mode === 'strip' || mode === 'classic') {
		masthead.classList.add('blemmy-masthead-collapsed');
		const hb = masthead.querySelector('.blemmy-header-block');
		if (hb && mastheadRight) { hb.appendChild(mastheadRight); }
		if (profile && main1) { main1.insertBefore(profile, main1.firstChild); }
	}
}

function applyLegacyWorkSplit(splitAt: number, docType: string): void {
	if (docType !== 'cv') { return; }
	const main1 = document.getElementById('blemmy-zone-main-body') ??
		document.getElementById('blemmy-main-1');
	const main2 = document.getElementById('blemmy-main-2');
	if (!main1 || !main2) { return; }

	const wrappers = Array.from(
		document.querySelectorAll<HTMLElement>('[data-blemmy-drag-group="work"]'),
	).sort((a, b) => {
		return parseInt(a.getAttribute('data-blemmy-drag-idx') ?? '0', 10) -
			parseInt(b.getAttribute('data-blemmy-drag-idx') ?? '0', 10);
	});

	wrappers.forEach((el, i) => {
		if (i < splitAt) { main1.appendChild(el); }
		else             { main2.appendChild(el); }
	});
}
