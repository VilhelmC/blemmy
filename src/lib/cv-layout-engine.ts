/**
 * cv-layout-engine.ts
 *
 * Pipeline:
 *  1. PROFILE      Measure section width-sensitivity (cv-profile.ts).
 *  2. GENERATE     Produce constraint-valid LayoutCandidates (cv-candidate.ts).
 *  3. SEARCH       Apply each candidate; measure height balance; score with
 *                  preferences-weighted affinity; keep the best.
 *  4. CLUSTER      Group scored results into perceptually distinct peaks;
 *                  emit cv-alternatives-ready if multiple peaks found.
 *  5. SIDEBAR      Binary-search the winning sidebar width.
 *  6. FILL         Largest fill level within page budget (single-page only).
 *  7. SLACK        Absorb spare column height into flex gap (capped).
 *  8. ALIGNMENT    Cross-column landmark snapping + safe-zone guard.
 *
 * Preferences (from cv-prefs.ts) are read on init and on cv-prefs-changed.
 * A selected alternative (from cv-alternative-selected) re-enters the pipeline
 * at step 5 with the chosen candidate locked in.
 */

import {
	columnSlackBelowDirectDivBlocksPx,
	ensureSidebarTailSpacer,
	removeSidebarTailSpacers,
	visibleDirectFlexItemCount,
} from '@lib/cv-column-slack';

import {
	analysePageAlignment,
	enforcedGapCap,
	BASE_MAIN_GAP_PX,
	BASE_SIDEBAR_GAP_PX,
} from '@lib/cv-align';

import {
	profileAllSections,
	logProfiles,
} from '@lib/cv-profile';

import {
	generateCandidates,
	type CandidateGenerationDiagnostics,
	widthAffinityPenalty,
	combinedScore,
	refineSidebarWidth,
	clusterCandidates,
	clusterLabel,
	logCandidates,
	type LayoutCandidate,
	type MastheadMode,
	type MovableSectionPlacement,
	type ScoredCandidate,
	type SectionProfileMap,
} from '@lib/cv-candidate';

import {
	loadPrefs,
	savePrefs,
	validatePrefs,
	dispatchAlternativesReady,
	PREFS_CHANGED_EVENT,
	ALTERNATIVE_SELECTED_EVENT,
	type CvPreferences,
	type PrefsChangedDetail,
	type AlternativeSelectedDetail,
	type AlternativeOption,
} from '@lib/cv-prefs';
import { hashAuditState, layoutAuditLog } from '@lib/layout-audit';

// ─── Physical constants ───────────────────────────────────────────────────────

const A4_HEIGHT_MM       = 297;
const MM_TO_PX           = 96 / 25.4;
const THRESHOLD_PX       = A4_HEIGHT_MM * MM_TO_PX;
const SAFETY             = 0.97;
const MAX_SINGLE_PAGE_PX = THRESHOLD_PX * SAFETY;
const OVERFLOW_RATIO     = 0.98;

// ─── Fixed tuning (not user-configurable) ─────────────────────────────────────

const RESIZE_MS               = 200;
const SLACK_GAP_FRACTION      = 0.97;
const MIN_COLUMN_SLACK_PX     = 2;
const SLACK_ABSORB_MAX_ROUNDS = 14;
const SLACK_TRIM_ROUNDS       = 12;
const SLACK_TRIM_FACTOR       = 0.72;

// ─── CSS variable names ───────────────────────────────────────────────────────

const SLACK_VAR_P1_MAIN          = '--cv-slack-gap-p1-main';
const SLACK_VAR_P1_SIDEBAR       = '--cv-slack-gap-p1-sidebar';
const SLACK_VAR_P2_MAIN          = '--cv-slack-gap-p2-main';
const SLACK_VAR_P2_SIDEBAR       = '--cv-slack-gap-p2-sidebar';
const SLACK_VAR_P1_MAIN_INNER    = '--cv-slack-gap-p1-main-inner';
const SLACK_VAR_P1_SIDEBAR_INNER = '--cv-slack-gap-p1-sidebar-inner';
const SLACK_VAR_P2_MAIN_INNER    = '--cv-slack-gap-p2-main-inner';
const SLACK_VAR_P2_SIDEBAR_INNER = '--cv-slack-gap-p2-sidebar-inner';
const ALIGN_VAR_P1_SIDEBAR       = '--cv-align-gap-p1-sidebar';
const ALIGN_VAR_P1_MAIN          = '--cv-align-gap-p1-main';
const ALIGN_VAR_P2_SIDEBAR       = '--cv-align-gap-p2-sidebar';
const ALIGN_VAR_P2_MAIN          = '--cv-align-gap-p2-main';
const SIDEBAR_WIDTH_VAR          = '--cv-sidebar-width-override';

const LOG = '[cv-layout]';

// ─── DOM element map ──────────────────────────────────────────────────────────

type LayoutEls = {
	card:          HTMLElement;
	shell:         HTMLElement;
	page1:         HTMLElement;
	page2:         HTMLElement;
	sidebar1:      HTMLElement;
	sidebar2:      HTMLElement;
	main1:         HTMLElement;
	main2:         HTMLElement;
	statusEl:      HTMLElement | null;
	elSkills:      HTMLElement | null;
	elLang:        HTMLElement | null;
	elInt:         HTMLElement | null;
	footer2:       HTMLElement | null;
	footer1:       HTMLElement | null;
	masthead:      HTMLElement | null;
	portraitCell:  HTMLElement | null;
	mastheadRight: HTMLElement | null;
	elProfile:     HTMLElement | null;
};

function getLayoutElements(): LayoutEls | null {
	const card     = document.getElementById('cv-card');
	const shell    = document.getElementById('cv-shell');
	const page1    = document.getElementById('cv-page-1');
	const page2    = document.getElementById('cv-page-2');
	const sidebar1 = document.getElementById('cv-sidebar-1');
	const sidebar2 = document.getElementById('cv-sidebar-2');
	const main1    = document.getElementById('cv-main-1');
	const main2    = document.getElementById('cv-main-2');
	if (!card || !shell || !page1 || !page2 || !sidebar1 || !sidebar2 || !main1 || !main2) {
		return null;
	}
	return {
		card, shell, page1, page2, sidebar1, sidebar2, main1, main2,
		statusEl:      document.getElementById('cv-layout-status'),
		elSkills:      document.getElementById('cv-rebalance-skills'),
		elLang:        document.getElementById('cv-rebalance-languages'),
		elInt:         document.getElementById('cv-rebalance-interests'),
		footer2:       document.getElementById('cv-page-2-body-footer'),
		footer1:       document.getElementById('cv-page-1-body-footer'),
		masthead:      document.getElementById('cv-page-1-masthead'),
		portraitCell:  document.getElementById('cv-p1-portrait-cell'),
		mastheadRight: document.getElementById('cv-masthead-right'),
		elProfile:     document.getElementById('cv-rebalance-profile'),
	};
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function raf2(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => { requestAnimationFrame(() => resolve()); });
	});
}

function mmNum(px: number): number {
	return Number((px / MM_TO_PX).toFixed(1));
}

function parsePxVar(el: HTMLElement, prop: string): number {
	const raw = el.style.getPropertyValue(prop).trim();
	if (!raw.endsWith('px')) { return 0; }
	const v = Number.parseFloat(raw);
	return Number.isNaN(v) ? 0 : v;
}

function sumFlexColumnContentPx(root: HTMLElement): number {
	const st    = getComputedStyle(root);
	const gapPx = parseFloat(st.rowGap || st.gap || '0') || 0;
	const kids  = Array.from(root.children).filter(
		(c): c is HTMLElement => c instanceof HTMLElement,
	);
	let sum = 0; let n = 0;
	for (const k of kids) {
		if (getComputedStyle(k).display === 'none') { continue; }
		sum += k.offsetHeight; n++;
	}
	if (n > 1) { sum += gapPx * (n - 1); }
	return sum;
}

// ─── Work-item helpers ────────────────────────────────────────────────────────

function getWorkItems(): HTMLElement[] {
	const wrapped = Array.from(document.querySelectorAll<HTMLElement>('[data-work-index]'));
	if (wrapped.length > 0) {
		return wrapped.sort((a, b) =>
			parseInt(a.dataset.workIndex ?? '0', 10) - parseInt(b.dataset.workIndex ?? '0', 10),
		);
	}

	// Fallback: if wrappers were lost by prior DOM mutations, use work blocks.
	return Array.from(document.querySelectorAll<HTMLElement>('.experience-block[data-work-idx]'))
		.sort((a, b) =>
			parseInt(a.dataset.workIdx ?? '0', 10) - parseInt(b.dataset.workIdx ?? '0', 10),
		);
}

function getWorkItemsDiag(): { count: number; source: 'wrapped' | 'block-fallback' | 'none' } {
	const wrappedCount = document.querySelectorAll('[data-work-index]').length;
	if (wrappedCount > 0) { return { count: wrappedCount, source: 'wrapped' }; }
	const fallbackCount = document.querySelectorAll('.experience-block[data-work-idx]').length;
	if (fallbackCount > 0) { return { count: fallbackCount, source: 'block-fallback' }; }
	return { count: 0, source: 'none' };
}

// ─── Sidebar width CSS ────────────────────────────────────────────────────────

function setSidebarWidth(card: HTMLElement, mm: number): void {
	card.style.setProperty(SIDEBAR_WIDTH_VAR, `${mm}mm`);
	card.dataset.cvSidebarMm = String(Math.round(mm));
}

function clearSidebarWidth(card: HTMLElement): void {
	card.style.removeProperty(SIDEBAR_WIDTH_VAR);
	delete card.dataset.cvSidebarMm;
}

// ─── Density ──────────────────────────────────────────────────────────────────

function setDensity(card: HTMLElement, level: number): void {
	card.classList.remove('cv-density-1', 'cv-density-2', 'cv-density-3');
	if (level >= 1 && level <= 3) { card.classList.add('cv-density-' + level); }
}

function clearDensity(card: HTMLElement): void {
	card.classList.remove('cv-density-1', 'cv-density-2', 'cv-density-3');
}

// ─── Masthead DOM helpers ─────────────────────────────────────────────────────

function portraitHeaderBlock(els: LayoutEls): HTMLElement | null {
	const hb = els.portraitCell?.querySelector('.cv-header-block');
	return hb instanceof HTMLElement ? hb : null;
}

function restoreMastheadToFull(els: LayoutEls): void {
	const { masthead, main1, elProfile, mastheadRight } = els;
	if (!masthead) { return; }
	masthead.classList.remove('cv-masthead-collapsed');
	const hb         = portraitHeaderBlock(els);
	const profileCol = document.getElementById('cv-masthead-profile-col');
	if (elProfile != null && main1 != null && main1.contains(elProfile) && profileCol != null) {
		profileCol.appendChild(elProfile);
	}
	if (mastheadRight != null && hb != null && hb.contains(mastheadRight)) {
		if (profileCol != null && masthead.contains(profileCol)) {
			masthead.insertBefore(mastheadRight, profileCol);
		} else {
			masthead.prepend(mastheadRight);
		}
	}
	if (mastheadRight != null && profileCol != null &&
		masthead.contains(mastheadRight) && masthead.contains(profileCol)) {
		masthead.insertBefore(mastheadRight, profileCol);
	}
}

function applyMastheadMode(els: LayoutEls, mode: MastheadMode): void {
	if (mode === 'full') { restoreMastheadToFull(els); return; }
	const { masthead, main1, elProfile, mastheadRight } = els;
	if (!masthead) { return; }
	const hb         = portraitHeaderBlock(els);
	const profileCol = document.getElementById('cv-masthead-profile-col');
	if (hb == null) { return; }
	if (mode === 'profile-sidebar-meta' && mastheadRight != null) {
		hb.appendChild(mastheadRight); return;
	}
	if (mode === 'profile-main' && elProfile != null && profileCol?.contains(elProfile)) {
		main1?.insertBefore(elProfile, main1.firstChild); return;
	}
	if (mode === 'classic') {
		masthead.classList.add('cv-masthead-collapsed');
		if (mastheadRight != null) { hb.appendChild(mastheadRight); }
		if (elProfile != null && profileCol?.contains(elProfile)) {
			main1?.insertBefore(elProfile, main1.firstChild);
		}
	}
}

// ─── Section placement ────────────────────────────────────────────────────────

type MovableEl = { key: 'skills' | 'languages' | 'interests'; el: HTMLElement };

function getMovableEls(els: LayoutEls): MovableEl[] {
	return ([
		{ key: 'skills',    el: els.elSkills },
		{ key: 'languages', el: els.elLang },
		{ key: 'interests', el: els.elInt },
	] as Array<{ key: MovableEl['key']; el: HTMLElement | null }>)
		.filter((x): x is MovableEl => x.el != null);
}

function restoreMovableToSidebar2(els: LayoutEls): void {
	const { sidebar2 } = els;
	const order = ['cv-rebalance-skills', 'cv-rebalance-languages', 'cv-rebalance-interests'];
	for (const id of order) {
		const el = document.getElementById(id);
		if (el && !sidebar2.contains(el)) { sidebar2.appendChild(el); }
	}
	for (const id of order) {
		const el = document.getElementById(id);
		if (el) { sidebar2.appendChild(el); }
	}
	ensureSidebarTailSpacer(sidebar2);
}

function applySectionPlacements(
	els:      LayoutEls,
	sections: LayoutCandidate['sections'],
): void {
	const { sidebar2, footer1, footer2 } = els;
	for (const { key, el } of getMovableEls(els)) {
		const placement: MovableSectionPlacement = sections[key];
		if (placement === 'sidebar') {
			if (!sidebar2.contains(el)) { sidebar2.appendChild(el); }
		} else if (placement === 'p1-footer' && footer1 != null) {
			if (!footer1.contains(el)) { footer1.appendChild(el); }
		} else if (placement === 'p2-footer' && footer2 != null) {
			if (!footer2.contains(el)) { footer2.appendChild(el); }
		}
	}
	ensureSidebarTailSpacer(sidebar2);
}

function setFooterCols(footer: HTMLElement | null, cols: 0 | 1 | 2 | 3): void {
	if (!footer) { return; }
	if (cols === 0) { footer.style.removeProperty('--cv-footer-cols'); }
	else            { footer.style.setProperty('--cv-footer-cols', String(cols)); }
}

// ─── Work item split ──────────────────────────────────────────────────────────

function applyWorkSplit(
	els:           LayoutEls,
	workItems:     HTMLElement[],
	pageSplitWork: number,
): () => void {
	const { main1, main2 } = els;

	function ensureSingleSection(main: HTMLElement, key: '1' | '2'): HTMLElement {
		const sections = Array.from(main.querySelectorAll<HTMLElement>('[data-work-section]'));
		let section = sections[0] ?? null;
		if (!section) {
			section = document.createElement('div');
			section.dataset.workSection = key;
			main.insertBefore(section, main.firstChild);
		}
		for (let i = 1; i < sections.length; i++) {
			sections[i].remove();
		}
		return section;
	}

	function setSectionLabel(section: HTMLElement, text: string | null): void {
		section.querySelectorAll(':scope > .section-label').forEach((n) => n.remove());
		if (!text) { return; }
		const label = document.createElement('span');
		label.className = 'section-label';
		label.textContent = text;
		section.prepend(label);
	}

	function applyWorkLabels(p1Count: number, p2Count: number): void {
		if (p1Count > 0 && p2Count > 0) {
			setSectionLabel(main1Section, 'Experience');
			setSectionLabel(main2Section, 'Additional Experience');
			return;
		}
		if (p1Count > 0) {
			setSectionLabel(main1Section, 'Experience');
			setSectionLabel(main2Section, null);
			return;
		}
		if (p2Count > 0) {
			setSectionLabel(main1Section, null);
			setSectionLabel(main2Section, 'Experience');
			return;
		}
		setSectionLabel(main1Section, null);
		setSectionLabel(main2Section, null);
	}

	const main1Section = ensureSingleSection(main1, '1');
	const main2Section = ensureSingleSection(main2, '2');

	main1Section.dataset.workSection = '1';
	main2Section.dataset.workSection = '2';

	main1Section.innerHTML = '';
	main2Section.innerHTML = '';

	let p1Count = 0;
	let p2Count = 0;
	for (let i = 0; i < workItems.length; i++) {
		if (i < pageSplitWork) {
			main1Section.appendChild(workItems[i]);
			p1Count += 1;
		} else {
			main2Section.appendChild(workItems[i]);
			p2Count += 1;
		}
	}
	applyWorkLabels(p1Count, p2Count);

	const capturedS1 = main1Section;
	const capturedS2 = main2Section;
	return () => {
		capturedS2.innerHTML = '';
		for (const item of workItems) { capturedS2.appendChild(item); }
		capturedS1.innerHTML = '';
		applyWorkLabels(0, workItems.length);
	};
}

// ─── Merge controller ─────────────────────────────────────────────────────────

function createMergeController(els: LayoutEls) {
	const movedSb: Node[] = [];
	const movedMn: Node[] = [];

	function unmerge(): void {
		removeSidebarTailSpacers(els.sidebar1);
		for (const n of movedSb) { els.sidebar2.appendChild(n as HTMLElement); }
		movedSb.length = 0;
		for (const n of movedMn) { els.main2.appendChild(n as HTMLElement); }
		movedMn.length = 0;
		els.card.classList.remove('cv-single-page');
		els.page2.style.display = '';
		removeSidebarTailSpacers(els.sidebar2);
		ensureSidebarTailSpacer(els.sidebar1);
		ensureSidebarTailSpacer(els.sidebar2);
	}

	function merge(): void {
		removeSidebarTailSpacers(els.sidebar1);
		removeSidebarTailSpacers(els.sidebar2);
		while (els.sidebar2.firstChild) {
			movedSb.push(els.sidebar2.firstChild);
			els.sidebar1.appendChild(els.sidebar2.firstChild);
		}
		while (els.main2.firstChild) {
			movedMn.push(els.main2.firstChild);
			els.main1.appendChild(els.main2.firstChild);
		}
		els.card.classList.add('cv-single-page');
		els.page2.style.display = 'none';
		ensureSidebarTailSpacer(els.sidebar1);
	}

	return { merge, unmerge };
}

// ─── Full DOM reset ───────────────────────────────────────────────────────────

function fullReset(els: LayoutEls): void {
	restoreMastheadToFull(els);
	restoreMovableToSidebar2(els);
	setFooterCols(els.footer1, 0);
	setFooterCols(els.footer2, 0);
	els.main1.querySelectorAll(':scope [data-work-section] > .section-label')
		.forEach((n) => n.remove());
	els.main2.querySelectorAll(':scope [data-work-section] > .section-label')
		.forEach((n) => n.remove());
	clearDensity(els.card);
	els.card.classList.remove('cv-single-page');
	els.page2.style.display = '';
}

// ─── Intrinsic height ─────────────────────────────────────────────────────────

function readIntrinsicGridHeightPx(page: HTMLElement): number {
	const grid = page.querySelector('.cv-grid');
	if (!grid) { return 0; }
	page.classList.add('cv-layout-measure-intrinsic');
	void page.offsetHeight;
	const h = (grid as HTMLElement).scrollHeight;
	page.classList.remove('cv-layout-measure-intrinsic');
	return h;
}

// ─── Two-page balance scoring ─────────────────────────────────────────────────

function scoreP2Balance(sbSum: number, mainSum: number, pagePx: number): number {
	const h     = Math.max(sbSum, mainSum, 1);
	const imb   = Math.abs(sbSum - mainSum) / h;
	const tailM = Math.max(0, pagePx - mainSum) / pagePx;
	const tailS = Math.max(0, pagePx - sbSum)   / pagePx;
	return imb * 100 + Math.sqrt(tailM) * 42 + Math.sqrt(tailS) * 26;
}

function scoreWhitespaceSlack(cols: HTMLElement[]): number {
	let score = 0;
	for (let i = 0; i < cols.length; i++) {
		const slack = columnSlackBelowDirectDivBlocksPx(cols[i]);
		const mm = slack / MM_TO_PX;
		if (mm < 8) { continue; }
		// Penalise large tails aggressively while ignoring small breathing room.
		score += Math.pow(mm - 8, 1.35) * 1.8;
	}
	return score;
}

function readP2ContentSums(els: LayoutEls): { sbSum: number; mainSum: number } {
	const { page2, sidebar2, main2 } = els;
	const grid = page2.querySelector('.cv-grid') as HTMLElement | null;
	page2.classList.add('cv-layout-measure-intrinsic');
	void page2.offsetHeight;
	const sbSum = sumFlexColumnContentPx(sidebar2);
	let mainSum = sumFlexColumnContentPx(main2);
	const foot  = els.footer2;
	if (foot != null && foot.children.length > 0) {
		const gSt    = grid != null ? getComputedStyle(grid) : null;
		const rowGap = gSt != null ? parseFloat(gSt.rowGap || gSt.gap || '0') || 0 : 0;
		mainSum     += rowGap + sumFlexColumnContentPx(foot);
	}
	page2.classList.remove('cv-layout-measure-intrinsic');
	return { sbSum, mainSum };
}

// ─── Candidate application and probing ───────────────────────────────────────

function applyCandidateDom(
	els:       LayoutEls,
	candidate: LayoutCandidate,
	workItems: HTMLElement[],
): () => void {
	applyMastheadMode(els, candidate.mastheadMode);
	applySectionPlacements(els, candidate.sections);
	setFooterCols(els.footer1, candidate.p1FooterCols);
	setFooterCols(els.footer2, candidate.p2FooterCols);
	setSidebarWidth(els.card, candidate.sidebarMm);
	const restoreWork = applyWorkSplit(els, workItems, candidate.pageSplitWork);

	return () => {
		restoreMastheadToFull(els);
		restoreMovableToSidebar2(els);
		setFooterCols(els.footer1, 0);
		setFooterCols(els.footer2, 0);
		clearSidebarWidth(els.card);
		restoreWork();
	};
}

async function probeSinglePageFit(
	els:        LayoutEls,
	mc:         ReturnType<typeof createMergeController>,
	candidate:  LayoutCandidate,
	workItems:  HTMLElement[],
	maxDensity: number,
): Promise<{ fits: boolean; density: number; restore: () => void }> {
	const restore = applyCandidateDom(els, candidate, workItems);
	mc.merge();
	let chosen = -1;
	for (let d = 0; d <= maxDensity; d++) {
		setDensity(els.card, d);
		await raf2();
		if (readIntrinsicGridHeightPx(els.page1) <= MAX_SINGLE_PAGE_PX) {
			chosen = d; break;
		}
	}
	if (chosen === -1) { mc.unmerge(); }
	return { fits: chosen >= 0, density: Math.max(0, chosen), restore };
}

async function probeTwoPageScore(
	els:       LayoutEls,
	candidate: LayoutCandidate,
	workItems: HTMLElement[],
	profiles:  SectionProfileMap,
	affinityWeight: number,
): Promise<{ heightScore: number; affinityScore: number; restore: () => void }> {
	const restore = applyCandidateDom(els, candidate, workItems);
	await raf2();
	const { sbSum, mainSum } = readP2ContentSums(els);
	const p2Score = scoreP2Balance(sbSum, mainSum, THRESHOLD_PX);
	const whitespacePenalty = scoreWhitespaceSlack([
		els.sidebar1,
		els.main1,
		els.sidebar2,
		els.main2,
	]);
	const heightScore   = p2Score + whitespacePenalty;
	const affinityScore = widthAffinityPenalty(candidate, profiles);
	return { heightScore, affinityScore, restore };
}

// ─── Slack + alignment passes ─────────────────────────────────────────────────

function clearSlackVars(els: LayoutEls): void {
	const cols = [els.sidebar1, els.main1, els.sidebar2, els.main2];
	const vars = [
		SLACK_VAR_P1_SIDEBAR, SLACK_VAR_P1_SIDEBAR_INNER,
		SLACK_VAR_P1_MAIN,    SLACK_VAR_P1_MAIN_INNER,
		SLACK_VAR_P2_SIDEBAR, SLACK_VAR_P2_SIDEBAR_INNER,
		SLACK_VAR_P2_MAIN,    SLACK_VAR_P2_MAIN_INNER,
	];
	for (const c of cols) { for (const v of vars) { c.style.removeProperty(v); } }
	els.card.removeAttribute('data-cv-slack-fill');
}

function clearAlignVars(els: LayoutEls): void {
	const cols = [els.sidebar1, els.main1, els.sidebar2, els.main2];
	const vars = [ALIGN_VAR_P1_SIDEBAR, ALIGN_VAR_P1_MAIN, ALIGN_VAR_P2_SIDEBAR, ALIGN_VAR_P2_MAIN];
	for (const c of cols) { for (const v of vars) { c.style.removeProperty(v); } }
	els.card.removeAttribute('data-cv-align-applied');
}

async function absorbSlackOnColumn(
	col: HTMLElement, outerVar: string, innerVar: string | null, baseGapPx: number,
): Promise<void> {
	for (let round = 0; round < SLACK_ABSORB_MAX_ROUNDS; round++) {
		const slack     = columnSlackBelowDirectDivBlocksPx(col);
		if (slack < MIN_COLUMN_SLACK_PX) { break; }
		const flexItems = visibleDirectFlexItemCount(col);
		const gapSlots  = Math.max(1, flexItems - 1);
		if (flexItems >= 2) {
			const cur  = parsePxVar(col, outerVar);
			const next = enforcedGapCap(cur + (slack / gapSlots) * SLACK_GAP_FRACTION, baseGapPx);
			if (next <= cur + 0.1) { break; }
			col.style.setProperty(outerVar, `${next}px`);
		} else if (innerVar != null) {
			const inner = col.firstElementChild;
			if (!(inner instanceof HTMLElement)) { break; }
			const m = inner.childElementCount;
			if (m < 2) { break; }
			const cur  = parsePxVar(col, innerVar);
			const next = enforcedGapCap(cur + (slack / (m - 1)) * SLACK_GAP_FRACTION, baseGapPx);
			if (next <= cur + 0.1) { break; }
			col.style.setProperty(innerVar, `${next}px`);
		} else { break; }
		await raf2();
	}
}

async function trimSlackIfOverflow(els: LayoutEls): Promise<void> {
	if (!els.card.classList.contains('cv-single-page')) { return; }
	const mainProps = [SLACK_VAR_P1_MAIN,    SLACK_VAR_P1_MAIN_INNER];
	const sbProps   = [SLACK_VAR_P1_SIDEBAR, SLACK_VAR_P1_SIDEBAR_INNER];
	let round = 0;
	while (round < SLACK_TRIM_ROUNDS && readIntrinsicGridHeightPx(els.page1) > MAX_SINGLE_PAGE_PX) {
		round++;
		let changed = trimOnce(els.main1, mainProps);
		if (!changed) { changed = trimOnce(els.sidebar1, sbProps); }
		if (!changed) { break; }
		await raf2();
	}
}

function trimOnce(el: HTMLElement, props: string[]): boolean {
	let changed = false;
	for (const prop of props) {
		const raw = el.style.getPropertyValue(prop).trim();
		if (!raw.endsWith('px')) { continue; }
		const v = Number.parseFloat(raw);
		if (Number.isNaN(v) || v < 0.5) { continue; }
		el.style.setProperty(prop, `${v * SLACK_TRIM_FACTOR}px`);
		changed = true;
	}
	return changed;
}

async function applySlackDistribution(els: LayoutEls): Promise<void> {
	clearSlackVars(els);
	await raf2();
	const single  = els.card.classList.contains('cv-single-page');
	const p2Shown = !single && els.page2.offsetParent !== null &&
		getComputedStyle(els.page2).display !== 'none';

	await absorbSlackOnColumn(els.sidebar1, SLACK_VAR_P1_SIDEBAR, SLACK_VAR_P1_SIDEBAR_INNER, BASE_SIDEBAR_GAP_PX);
	await absorbSlackOnColumn(els.main1,    SLACK_VAR_P1_MAIN,    SLACK_VAR_P1_MAIN_INNER,    BASE_MAIN_GAP_PX);
	if (p2Shown) {
		await absorbSlackOnColumn(els.sidebar2, SLACK_VAR_P2_SIDEBAR, SLACK_VAR_P2_SIDEBAR_INNER, BASE_SIDEBAR_GAP_PX);
		await absorbSlackOnColumn(els.main2,    SLACK_VAR_P2_MAIN,    SLACK_VAR_P2_MAIN_INNER,    BASE_MAIN_GAP_PX);
	}

	const applied: string[] = [];
	function push(el: HTMLElement, v: string): void {
		const px = parsePxVar(el, v);
		if (px >= 0.35) { applied.push(`${v}:${mmNum(px)}`); }
	}
	[
		[els.sidebar1, SLACK_VAR_P1_SIDEBAR], [els.sidebar1, SLACK_VAR_P1_SIDEBAR_INNER],
		[els.main1,    SLACK_VAR_P1_MAIN],    [els.main1,    SLACK_VAR_P1_MAIN_INNER],
	].forEach(([el, v]) => push(el as HTMLElement, v as string));
	if (p2Shown) {
		[
			[els.sidebar2, SLACK_VAR_P2_SIDEBAR], [els.sidebar2, SLACK_VAR_P2_SIDEBAR_INNER],
			[els.main2,    SLACK_VAR_P2_MAIN],    [els.main2,    SLACK_VAR_P2_MAIN_INNER],
		].forEach(([el, v]) => push(el as HTMLElement, v as string));
	}
	if (applied.length > 0) { els.card.dataset.cvSlackFill = applied.join(','); }
	await raf2();
	await trimSlackIfOverflow(els);
}

async function applyAlignmentPass(els: LayoutEls): Promise<void> {
	clearAlignVars(els);
	await raf2();
	const single  = els.card.classList.contains('cv-single-page');
	const p2Shown = !single && els.page2.offsetParent !== null &&
		getComputedStyle(els.page2).display !== 'none';

	const notes: string[] = [];
	let applied = false;

	async function alignPage(
		page: HTMLElement, sidebar: HTMLElement, main: HTMLElement,
		sbVar: string, mnVar: string, sbSlack: string, mnSlack: string, label: string,
	): Promise<void> {
		const r = analysePageAlignment(page, sidebar, main, THRESHOLD_PX);
		if (r.pairs.length > 0) { notes.push(`${label} ${r.pairs.length}pair(s)`); }
		if (r.alignExtraSidebarPx > 0) {
			const cur  = parsePxVar(sidebar, sbSlack);
			const room = Math.max(0, enforcedGapCap(cur + r.alignExtraSidebarPx, BASE_SIDEBAR_GAP_PX) - cur);
			if (room > 0) {
				sidebar.style.setProperty(sbVar, `${room}px`);
				applied = true;
				notes.push(`${label} sb+${mmNum(room)}mm`);
			}
		}
		if (r.alignExtraMainPx > 0) {
			const cur  = parsePxVar(main, mnSlack);
			const room = Math.max(0, enforcedGapCap(cur + r.alignExtraMainPx, BASE_MAIN_GAP_PX) - cur);
			if (room > 0) {
				main.style.setProperty(mnVar, `${room}px`);
				applied = true;
				notes.push(`${label} mn+${mmNum(room)}mm`);
			}
		}
		await raf2();
		if (r.violations.length > 0) {
			notes.push(`${label} safe-zone → revert`);
			sidebar.style.removeProperty(sbVar);
			main.style.removeProperty(mnVar);
		}
	}

	await alignPage(
		els.page1, els.sidebar1, els.main1,
		ALIGN_VAR_P1_SIDEBAR, ALIGN_VAR_P1_MAIN,
		SLACK_VAR_P1_SIDEBAR, SLACK_VAR_P1_MAIN, 'P1',
	);
	if (p2Shown) {
		await alignPage(
			els.page2, els.sidebar2, els.main2,
			ALIGN_VAR_P2_SIDEBAR, ALIGN_VAR_P2_MAIN,
			SLACK_VAR_P2_SIDEBAR, SLACK_VAR_P2_MAIN, 'P2',
		);
	}
	if (single) { await trimSlackIfOverflow(els); }
	if (notes.length > 0) {
		const summary = notes.join(' · ');
		if (applied) { els.card.dataset.cvAlignApplied = summary; }
		console.log(LOG + ' Align: ' + summary);
	}
}

// ─── Post-search: fill, sidebar refinement, slack, align ─────────────────────

async function finaliseLayout(
	els:       LayoutEls,
	mc:        ReturnType<typeof createMergeController>,
	winner:    LayoutCandidate,
	profiles:  SectionProfileMap,
	workItems: HTMLElement[],
	isSingle:  boolean,
): Promise<void> {
	// Fill (single-page only)
	if (isSingle) {
		let best = 0;
		for (let f = 1; f <= 3; f++) {
			els.card.classList.remove('cv-fill-1', 'cv-fill-2', 'cv-fill-3');
			els.card.classList.add('cv-fill-' + f);
			await raf2();
			if (readIntrinsicGridHeightPx(els.page1) > MAX_SINGLE_PAGE_PX) {
				els.card.classList.remove('cv-fill-' + f); break;
			}
			best = f;
		}
		els.card.classList.remove('cv-fill-1', 'cv-fill-2', 'cv-fill-3');
		if (best > 0) { els.card.classList.add('cv-fill-' + best); }
		els.card.dataset.cvFill = String(best);
	}

	// Sidebar width refinement
	const baseSb = winner.sidebarMm;
	const refined = await refineSidebarWidth(baseSb, async (mm) => {
		setSidebarWidth(els.card, mm);
		await raf2();
		if (isSingle) {
			const h = readIntrinsicGridHeightPx(els.page1);
			if (h > MAX_SINGLE_PAGE_PX) { return 9999; }
			return mm; // prefer narrower sidebar when single-page
		} else {
			const { sbSum, mainSum } = readP2ContentSums(els);
			return scoreP2Balance(sbSum, mainSum, THRESHOLD_PX) +
				widthAffinityPenalty({ ...winner, sidebarMm: mm }, profiles);
		}
	});
	setSidebarWidth(els.card, refined);
	await raf2();
	// Guard: revert if refinement pushed single-page over budget
	if (isSingle && readIntrinsicGridHeightPx(els.page1) > MAX_SINGLE_PAGE_PX) {
		setSidebarWidth(els.card, baseSb);
	}

	await applySlackDistribution(els);
	await applyAlignmentPass(els);
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export function initCvLayoutEngine(): () => void {
	const _elsOrNull = getLayoutElements();
	if (!_elsOrNull) { return () => { /* nothing to clean up */ }; }
	const els: LayoutEls = _elsOrNull;

	const mc         = createMergeController(els);
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;
	let layoutRunning = false;
	let layoutQueued = false;

	// Current preferences (mutable, updated by event listener)
	let prefs: CvPreferences = loadPrefs();

	// Scored candidates from the last full search (for alternative application)
	let lastScoredCandidates: ScoredCandidate[] = [];
	let lastProfiles: SectionProfileMap | null  = null;
	let lastWorkItems: HTMLElement[]             = [];

	function layoutTargetActive(): boolean {
		return (
			els.shell.classList.contains('cv-print-preview') ||
			window.matchMedia('print').matches
		);
	}

	function setStatus(msg: string, type: 'ok' | 'warn'): void {
		if (!els.statusEl) { return; }
		els.statusEl.textContent = msg;
		els.statusEl.className   = 'cv-layout-status no-print cv-status-' + type;
	}

	function markReady(): void {
		els.card.setAttribute('data-cv-layout-ready', 'true');
		window.dispatchEvent(new Event('cv-layout-applied'));
	}

	// ── Emit alternative options to the UI ────────────────────────────────

	function emitAlternatives(
		scored:  ScoredCandidate[],
		winnerId: string,
	): void {
		const clusters = clusterCandidates(scored);
		let options: AlternativeOption[] = [];
		if (clusters.length >= 2) {
			options = clusters.map((s) => ({
				candidateId: s.candidate.id,
				label:       clusterLabel(s),
				score:       s.combined,
				active:      s.candidate.id === winnerId,
			}));
		} else {
			// Fallback: still expose radios when multiple scored candidates exist.
			// This avoids an empty panel in cases where clustering collapses to one.
			options = scored
				.slice(0, 6)
				.map((s) => ({
					candidateId: s.candidate.id,
					label: clusterLabel(s),
					score: s.combined,
					active: s.candidate.id === winnerId,
				}));
		}
		if (options.length < 2) {
			dispatchAlternativesReady([]);
			return;
		}
		dispatchAlternativesReady(options);
	}

	// ── Apply a specific alternative (called when user selects radio) ──────

	async function applyAlternative(candidateId: string): Promise<void> {
		if (!lastProfiles) { return; }
		const target = lastScoredCandidates.find((s) => s.candidate.id === candidateId);
		if (!target) { return; }

		els.card.removeAttribute('data-cv-layout-ready');
		els.card.dataset.cvMeasuring = 'true';
		fullReset(els);
		clearSidebarWidth(els.card);
		clearSlackVars(els);
		clearAlignVars(els);

		const c        = target.candidate;
		const isSingle = c.pages === 1;
		const restore  = applyCandidateDom(els, c, lastWorkItems);

		if (isSingle) {
			mc.merge();
			// Find minimum fitting density
			let chosenDensity = 0;
			for (let d = 0; d <= prefs.maxDensity; d++) {
				setDensity(els.card, d);
				await raf2();
				if (readIntrinsicGridHeightPx(els.page1) <= MAX_SINGLE_PAGE_PX) {
					chosenDensity = d; break;
				}
			}
			setDensity(els.card, chosenDensity);
			setStatus(`Applying: ${c.id}`, 'ok');
		} else {
			await raf2();
			setStatus(`Applying: ${c.id}`, 'ok');
		}

		await finaliseLayout(els, mc, c, lastProfiles, lastWorkItems, isSingle);

		const nearOfl = isSingle &&
			readIntrinsicGridHeightPx(els.page1) > MAX_SINGLE_PAGE_PX * OVERFLOW_RATIO;
		const finalSb = parseFloat(
			els.card.style.getPropertyValue(SIDEBAR_WIDTH_VAR).replace('mm', '') || String(c.sidebarMm),
		);
		setStatus(
			isSingle
				? `1 page · sb ${Math.round(finalSb)}mm${nearOfl ? ' (near overflow)' : ''}`
				: `2 pages · sb ${Math.round(finalSb)}mm`,
			nearOfl ? 'warn' : 'ok',
		);

		// Mark the new active alternative in the UI
		emitAlternatives(lastScoredCandidates ?? [], candidateId);

		delete els.card.dataset.cvMeasuring;
		markReady();
		void restore; // restore is held by the engine state now
	}

	// ── Full layout pass ──────────────────────────────────────────────────

	async function applyLayout(): Promise<void> {
		const t0 = performance.now();
		const prevPages = Number(els.card.dataset.cvPages ?? 0);
		const prevWinnerId = els.card.dataset.cvWinnerId ?? '';
		const editModeActive = document.documentElement.classList.contains('cv-edit-mode');
		layoutAuditLog('engine-apply:start', {
			layoutRunning,
			layoutQueued,
			prevPages,
			prevWinnerId,
			editModeActive,
		});
		els.card.removeAttribute('data-cv-layout-ready');
		els.card.dataset.cvMeasuring = 'true';
		els.card.removeAttribute('data-cv-layout-error');
		els.card.dataset.cvPagePreference = prefs.pagePreference;
		els.card.removeAttribute('data-cv-winner-id');
		els.card.removeAttribute('data-cv-candidates-total');
		els.card.removeAttribute('data-cv-candidates-single');
		els.card.removeAttribute('data-cv-candidates-two');
		els.card.removeAttribute('data-cv-scored-total');
		els.card.removeAttribute('data-cv-scored-single');
		els.card.removeAttribute('data-cv-scored-two');
		els.card.removeAttribute('data-cv-layout-ms');
		fullReset(els);
		clearSidebarWidth(els.card);
		clearSlackVars(els);
		clearAlignVars(els);
		els.card.classList.remove('cv-fill-1', 'cv-fill-2', 'cv-fill-3');
		els.card.dataset.cvFill = '0';

		if (!layoutTargetActive()) {
			// Web mode: still place work items so the main columns render.
			// Print-fit scoring is skipped, but content should remain visible.
			const workItems = getWorkItems();
			if (workItems.length > 0) {
				const split =
					workItems.length <= 2 ? workItems.length : 2;
				applyWorkSplit(els, workItems, split);
			}
			els.card.dataset.cvDisposition = 'web-idle';
			els.card.dataset.cvPages       = '2';
			els.card.dataset.cvLayoutMs    = String(Math.round(performance.now() - t0));
			setStatus('Web view: use Print view for page fit', 'ok');
			delete els.card.dataset.cvMeasuring;
			markReady();
			return;
		}

		// 1. Profile
		const profiles = profileAllSections({
			elSkills:  els.elSkills,
			elLang:    els.elLang,
			elInt:     els.elInt,
			elProfile: els.elProfile,
			sidebar1:  els.sidebar1,
		});
		logProfiles(profiles);
		lastProfiles = profiles;

		const workItems = getWorkItems();
		lastWorkItems   = workItems;
		const workCount = workItems.length;
		const workDiag = getWorkItemsDiag();
		els.card.dataset.cvWorkItemsCount = String(workDiag.count);
		els.card.dataset.cvWorkItemsSource = workDiag.source;

		// 2. Generate candidates
		const candDiag: CandidateGenerationDiagnostics = {
			totalCombinations: 0,
			accepted: 0,
			rejected: 0,
			rejectionsByRule: {},
		};
		const candidates = generateCandidates(workCount, profiles, candDiag);
		layoutAuditLog('engine-candidates', {
			workCount,
			total: candidates.length,
			tried: candDiag.totalCombinations,
			rejected: candDiag.rejected,
		});
		els.card.dataset.cvCandidatesTotal  = String(candidates.length);
		els.card.dataset.cvCandidatesTried = String(candDiag.totalCombinations);
		els.card.dataset.cvCandidatesRejected = String(candDiag.rejected);
		const topRejection = Object.entries(candDiag.rejectionsByRule)
			.sort((a, b) => b[1] - a[1])[0];
		if (topRejection) {
			els.card.dataset.cvCandidatesRejectTop = `${topRejection[0]}:${topRejection[1]}`;
		} else {
			els.card.removeAttribute('data-cv-candidates-reject-top');
		}
		logCandidates(candidates, profiles);

		const single1 = candidates.filter((c) => c.pages === 1);
		const two2    = candidates.filter((c) => c.pages === 2);
		els.card.dataset.cvCandidatesSingle = String(single1.length);
		els.card.dataset.cvCandidatesTwo    = String(two2.length);

		// 3. Search — strategy controlled by pagePreference
		const searchBoth   = prefs.pagePreference === 'auto';
		const skipSingle   = prefs.pagePreference === 'prefer-2';
		const skipTwo      = prefs.pagePreference === 'prefer-1';

		const allScored: ScoredCandidate[] = [];

		// Score single-page candidates
		if (!skipSingle) {
			for (const candidate of single1) {
				fullReset(els);
				clearDensity(els.card);
				const { fits, density, restore } = await probeSinglePageFit(
					els, mc, candidate, workItems, prefs.maxDensity,
				);
				if (fits) {
					const affinityScore = widthAffinityPenalty(candidate, profiles);
					const whitespacePenalty = scoreWhitespaceSlack([
						els.sidebar1,
						els.main1,
					]);
					const heightScore = density * 20 + whitespacePenalty;
					allScored.push({
						candidate,
						heightScore,
						affinityScore,
						combined: combinedScore(heightScore, affinityScore, 1.0, prefs.affinityWeight),
					});
					mc.unmerge();
				}
				restore();
			}
		}

		// Score two-page candidates
		if (!skipTwo || allScored.length === 0) {
			for (const candidate of two2) {
				fullReset(els);
				const { heightScore, affinityScore, restore } =
					await probeTwoPageScore(els, candidate, workItems, profiles, prefs.affinityWeight);
				allScored.push({
					candidate,
					heightScore,
					affinityScore,
					combined: combinedScore(heightScore, affinityScore, 1.0, prefs.affinityWeight),
				});
				restore();
			}
		}

		if (allScored.length === 0) {
			els.card.dataset.cvScoredTotal = '0';
			els.card.dataset.cvScoredSingle = '0';
			els.card.dataset.cvScoredTwo = '0';
			els.card.dataset.cvLayoutError = 'no-valid-candidate';
			els.card.dataset.cvLayoutMs = String(Math.round(performance.now() - t0));
			setStatus('No valid layout found', 'warn');
			delete els.card.dataset.cvMeasuring;
			markReady();
			return;
		}
		els.card.dataset.cvScoredTotal  = String(allScored.length);
		els.card.dataset.cvScoredSingle = String(allScored.filter((s) => s.candidate.pages === 1).length);
		els.card.dataset.cvScoredTwo    = String(allScored.filter((s) => s.candidate.pages === 2).length);

		// 4. Sort + cluster
		allScored.sort((a, b) => {
			const byCombined = a.combined - b.combined;
			if (Math.abs(byCombined) > 0.0001) { return byCombined; }
			const byHeight = a.heightScore - b.heightScore;
			if (Math.abs(byHeight) > 0.0001) { return byHeight; }
			const byAffinity = a.affinityScore - b.affinityScore;
			if (Math.abs(byAffinity) > 0.0001) { return byAffinity; }
			return a.candidate.id.localeCompare(b.candidate.id);
		});
		lastScoredCandidates = allScored;
		layoutAuditLog('engine-scored', {
			total: allScored.length,
			hash: hashAuditState(allScored.map((s) => ({
				id: s.candidate.id,
				pages: s.candidate.pages,
				combined: Number(s.combined.toFixed(3)),
			}))),
			single: allScored.filter((s) => s.candidate.pages === 1).length,
			two: allScored.filter((s) => s.candidate.pages === 2).length,
			pagePreference: prefs.pagePreference,
		});

		// Winner policy:
		// - auto: prefer single-page whenever a valid single-page fit exists
		// - prefer-1: force single-page when available
		// - prefer-2: force two-page when available
		let winnerIdx = 0;
		if (prefs.pagePreference === 'auto') {
			const firstSingle = allScored.findIndex((s) => s.candidate.pages === 1);
			if (firstSingle >= 0) { winnerIdx = firstSingle; }
		} else if (prefs.pagePreference === 'prefer-1') {
			const firstSingle = allScored.findIndex((s) => s.candidate.pages === 1);
			if (firstSingle >= 0) { winnerIdx = firstSingle; }
		} else if (prefs.pagePreference === 'prefer-2') {
			const firstTwo = allScored.findIndex((s) => s.candidate.pages === 2);
			if (firstTwo >= 0) { winnerIdx = firstTwo; }
		}
		// Edit-mode stabilizer: if previous result was single-page and a single-page
		// candidate still fits, keep single-page to avoid surprising expansion on hide.
		if (
			editModeActive &&
			prefs.pagePreference !== 'prefer-2' &&
			prevPages === 1
		) {
			const firstSingle = allScored.findIndex((s) => s.candidate.pages === 1);
			if (firstSingle >= 0) { winnerIdx = firstSingle; }
		}
		// Reduce winner churn for equivalent content states: prefer previous winner
		// when it remains effectively tied with the selected winner.
		if (editModeActive && prevWinnerId) {
			const prevIdx = allScored.findIndex((s) => s.candidate.id === prevWinnerId);
			if (prevIdx >= 0) {
				const current = allScored[winnerIdx];
				const prev = allScored[prevIdx];
				if (current && prev) {
					const delta = Math.abs(prev.combined - current.combined);
					if (delta <= 0.5) {
						winnerIdx = prevIdx;
					}
				}
			}
		}

		const winner   = allScored[winnerIdx];
		els.card.dataset.cvWinnerId = winner.candidate.id;
		const isSingle = winner.candidate.pages === 1;
		layoutAuditLog('engine-winner', {
			winnerId: winner.candidate.id,
			pages: winner.candidate.pages,
			combined: Number(winner.combined.toFixed(3)),
		});

		// 5. Apply winner DOM
		fullReset(els);
		const restore = applyCandidateDom(els, winner.candidate, workItems);
		void restore; // engine holds this state

		if (isSingle) {
			mc.merge();
			// Re-apply minimum fitting density for the winner
			let chosenDensity = 0;
			for (let d = 0; d <= prefs.maxDensity; d++) {
				setDensity(els.card, d);
				await raf2();
				if (readIntrinsicGridHeightPx(els.page1) <= MAX_SINGLE_PAGE_PX) {
					chosenDensity = d; break;
				}
			}
			setDensity(els.card, chosenDensity);
			els.card.dataset.cvDensity = String(chosenDensity);
		}

		// 6 + 7 + 8. Fill, sidebar refinement, slack, alignment
		await finaliseLayout(els, mc, winner.candidate, profiles, workItems, isSingle);

		// Write disposition metadata
		const finalSb  = parseFloat(
			els.card.style.getPropertyValue(SIDEBAR_WIDTH_VAR).replace('mm', '') ||
			String(winner.candidate.sidebarMm),
		);
		const nearOfl  = isSingle &&
			readIntrinsicGridHeightPx(els.page1) > MAX_SINGLE_PAGE_PX * OVERFLOW_RATIO;

		els.card.dataset.cvDisposition  = isSingle ? 'single-page' : 'two-page';
		els.card.dataset.cvPages        = isSingle ? '1' : '2';
		els.card.dataset.cvMastheadMode = winner.candidate.mastheadMode;
		els.card.dataset.cvSections     = JSON.stringify(winner.candidate.sections);
		els.card.dataset.cvSplit        = String(winner.candidate.pageSplitWork);
		if (nearOfl) { els.card.dataset.cvOverflowRisk = 'true'; }
		else         { els.card.removeAttribute('data-cv-overflow-risk'); }

		setStatus(
			isSingle
				? `1 page · sb ${Math.round(finalSb)}mm${nearOfl ? ' (near overflow)' : ''}`
				: `2 pages · sb ${Math.round(finalSb)}mm · split ${winner.candidate.pageSplitWork}`,
			nearOfl ? 'warn' : 'ok',
		);

		console.groupCollapsed(LOG + ` ${isSingle ? 'One' : 'Two'} page(s)`);
		console.table({
			Disposition:  isSingle ? 'single-page' : 'two-page',
			SidebarMm:    Math.round(finalSb),
			Masthead:     winner.candidate.mastheadMode,
			Skills:       winner.candidate.sections.skills,
			Languages:    winner.candidate.sections.languages,
			Interests:    winner.candidate.sections.interests,
			Split:        winner.candidate.pageSplitWork,
			'Height↓':    winner.heightScore.toFixed(1),
			'Affinity↓':  winner.affinityScore.toFixed(1),
			'Combined↓':  winner.combined.toFixed(1),
		});
		console.groupEnd();

		// 4b. Emit alternatives to the UI (after winner is applied)
		emitAlternatives(allScored, winner.candidate.id);
		els.card.dataset.cvLayoutMs = String(Math.round(performance.now() - t0));
		layoutAuditLog('engine-apply:done', {
			winnerId: winner.candidate.id,
			layoutMs: els.card.dataset.cvLayoutMs,
			pages: els.card.dataset.cvPages,
		});

		delete els.card.dataset.cvMeasuring;
		markReady();
	}

	function requestLayout(): void {
		layoutAuditLog('engine-request-layout', {
			layoutRunning,
			layoutQueued,
		});
		if (layoutRunning) {
			layoutQueued = true;
			return;
		}
		layoutRunning = true;
		void applyLayout()
			.finally(() => {
				delete els.card.dataset.cvMeasuring;
				layoutRunning = false;
				if (layoutQueued) {
					layoutQueued = false;
					requestLayout();
				}
			});
	}

	// ── Event listeners ───────────────────────────────────────────────────

	function scheduleLayout(): void {
		if (!els.card.isConnected || !els.shell.isConnected) { return; }
		if (resizeTimer) { clearTimeout(resizeTimer); }
		resizeTimer = setTimeout(() => { requestLayout(); }, RESIZE_MS);
	}

	function handlePrefsChanged(e: Event): void {
		const detail = (e as CustomEvent<PrefsChangedDetail>).detail;
		prefs = validatePrefs(detail.prefs);
		savePrefs(prefs);
		scheduleLayout();
	}

	function handleAlternativeSelected(e: Event): void {
		const detail = (e as CustomEvent<AlternativeSelectedDetail>).detail;
		void applyAlternative(detail.candidateId);
	}

	window.addEventListener(PREFS_CHANGED_EVENT, handlePrefsChanged);
	window.addEventListener(ALTERNATIVE_SELECTED_EVENT, handleAlternativeSelected);

	// Run once immediately; fonts-ready reruns for final measurements.
	requestLayout();
	document.fonts.ready.then(() => { requestLayout(); });
	window.addEventListener('resize', scheduleLayout);

	// Return a cleanup function for re-render scenarios (main.ts)
	return () => {
		if (resizeTimer) { clearTimeout(resizeTimer); }
		window.removeEventListener('resize', scheduleLayout);
		window.removeEventListener(PREFS_CHANGED_EVENT, handlePrefsChanged);
		window.removeEventListener(ALTERNATIVE_SELECTED_EVENT, handleAlternativeSelected);
	};
}
