import type { CVData, CVLayoutSnapshot } from '@cv/cv';

type LayoutSections = CVLayoutSnapshot['sections'];

function parseCols(raw: string): 0 | 1 | 2 | 3 {
	const n = Number.parseInt(raw, 10);
	if (n >= 1 && n <= 3) { return n as 1 | 2 | 3; }
	return 0;
}

function readDensity(card: HTMLElement): 0 | 1 | 2 | 3 {
	for (const level of [3, 2, 1] as const) {
		if (card.classList.contains(`blemmy-density-${level}`)) {
			return level;
		}
	}
	return 0;
}

function readFill(card: HTMLElement): 0 | 1 | 2 | 3 {
	for (const level of [3, 2, 1] as const) {
		if (card.classList.contains(`blemmy-fill-${level}`)) {
			return level;
		}
	}
	return 0;
}

function readSections(card: HTMLElement): LayoutSections {
	const fallback: LayoutSections = {
		skills: 'sidebar',
		languages: 'sidebar',
		interests: 'sidebar',
	};
	const raw = card.dataset.blemmyLayoutSections;
	if (!raw) { return fallback; }
	try {
		const parsed = JSON.parse(raw) as Partial<LayoutSections>;
		if (!parsed) { return fallback; }
		return {
			skills: parsed.skills ?? 'sidebar',
			languages: parsed.languages ?? 'sidebar',
			interests: parsed.interests ?? 'sidebar',
		};
	} catch {
		return fallback;
	}
}

export function captureLayoutSnapshotFromDom(): CVLayoutSnapshot | null {
	const card = document.getElementById('blemmy-card');
	if (!(card instanceof HTMLElement)) { return null; }
	const sidebarRaw = card.style
		.getPropertyValue('--blemmy-sidebar-width-override')
		.trim();
	const sidebarMm = Number.parseFloat(sidebarRaw.replace('mm', ''));
	const pages = card.classList.contains('blemmy-single-page') ? 1 : 2;
	const p1Footer = document.getElementById('blemmy-page-1-body-footer');
	const p2Footer = document.getElementById('blemmy-page-2-body-footer');
	const p1Cols = parseCols(
		(p1Footer as HTMLElement | null)?.style
			.getPropertyValue('--blemmy-footer-cols')
			.trim() ?? '',
	);
	const p2Cols = parseCols(
		(p2Footer as HTMLElement | null)?.style
			.getPropertyValue('--blemmy-footer-cols')
			.trim() ?? '',
	);
	const rawMh = card.dataset.blemmyLayoutHeaderVariant;
	const rescueModes = new Set([
		'compact',
		'minimal',
		'strip',
		'profile-sidebar-meta',
		'profile-main',
		'classic',
	]);
	const mastheadMode =
		rawMh && rescueModes.has(rawMh) ? rawMh as CVLayoutSnapshot['mastheadMode'] : 'full';
	const splitRaw = Number.parseInt(card.dataset.blemmyLayoutWorkSplit ?? '0', 10);
	return {
		pages,
		mastheadMode,
		sections: readSections(card),
		pageSplitWork: Number.isFinite(splitRaw) ? Math.max(0, splitRaw) : 0,
		sidebarMm: Number.isFinite(sidebarMm) ? sidebarMm : 52,
		density: readDensity(card),
		fill: readFill(card),
		p1FooterCols: p1Cols,
		p2FooterCols: p2Cols,
	};
}

export function withCapturedLayoutSnapshot(data: CVData): CVData {
	const snapshot = captureLayoutSnapshotFromDom();
	if (!snapshot) { return data; }
	return {
		...data,
		layoutSnapshot: snapshot,
	};
}

function setFooterCols(footerId: string, cols: 0 | 1 | 2 | 3): void {
	const footer = document.getElementById(footerId);
	if (!(footer instanceof HTMLElement)) { return; }
	if (cols > 0) {
		footer.style.setProperty('--blemmy-footer-cols', String(cols));
		return;
	}
	footer.style.removeProperty('--blemmy-footer-cols');
}

function applyMastheadMode(mode: CVLayoutSnapshot['mastheadMode']): void {
	const masthead = document.getElementById('blemmy-page-1-masthead');
	const hb = document.querySelector(
		'#blemmy-p1-portrait-cell .blemmy-header-block',
	);
	const profileCol = document.getElementById('blemmy-masthead-profile-col');
	const profile = document.getElementById('blemmy-rebalance-profile');
	const mastheadRight = document.getElementById('blemmy-masthead-right');
	const main1 = document.getElementById('blemmy-main-1');
	if (!(masthead instanceof HTMLElement) || !(hb instanceof HTMLElement)) {
		return;
	}
	masthead.classList.remove('blemmy-masthead-collapsed');
	delete masthead.dataset.blemmyVariant;
	if (profile && profileCol && !profileCol.contains(profile)) {
		profileCol.appendChild(profile);
	}
	if (mastheadRight && !masthead.contains(mastheadRight)) {
		masthead.prepend(mastheadRight);
	}
	if (mode === 'full') { return; }

	masthead.dataset.blemmyVariant = mode;
	if ((mode === 'compact' || mode === 'profile-sidebar-meta') && mastheadRight) {
		hb.appendChild(mastheadRight);
		return;
	}
	if ((mode === 'minimal' || mode === 'profile-main') && profile && main1) {
		main1.insertBefore(profile, main1.firstChild);
		return;
	}
	if (mode === 'strip' || mode === 'classic') {
		masthead.classList.add('blemmy-masthead-collapsed');
		if (mastheadRight) { hb.appendChild(mastheadRight); }
		if (profile && main1) {
			main1.insertBefore(profile, main1.firstChild);
		}
	}
}

function applySectionPlacements(sections: LayoutSections): void {
	const sidebar2 = document.getElementById('blemmy-sidebar-2');
	const footer1 = document.getElementById('blemmy-page-1-body-footer');
	const footer2 = document.getElementById('blemmy-page-2-body-footer');
	if (!(sidebar2 instanceof HTMLElement)) { return; }
	const map: Array<[keyof LayoutSections, string]> = [
		['skills', 'blemmy-rebalance-skills'],
		['languages', 'blemmy-rebalance-languages'],
		['interests', 'blemmy-rebalance-interests'],
	];
	for (const [, id] of map) {
		const el = document.getElementById(id);
		if (el) { sidebar2.appendChild(el); }
	}
	for (const [key, id] of map) {
		const el = document.getElementById(id);
		if (!(el instanceof HTMLElement)) { continue; }
		const where = sections[key];
		if (where === 'p1-footer' && footer1 instanceof HTMLElement) {
			footer1.appendChild(el);
			continue;
		}
		if (where === 'p2-footer' && footer2 instanceof HTMLElement) {
			footer2.appendChild(el);
			continue;
		}
		sidebar2.appendChild(el);
	}
}

function sortedWorkWrappers(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[data-work-index]'))
		.sort((a, b) => {
			const ai = Number.parseInt(a.dataset.workIndex ?? '0', 10);
			const bi = Number.parseInt(b.dataset.workIndex ?? '0', 10);
			return ai - bi;
		});
}

function ensureSection(main: HTMLElement, key: '1' | '2'): HTMLElement {
	const existing = main.querySelector<HTMLElement>('[data-work-section]');
	if (existing) {
		existing.dataset.workSection = key;
		return existing;
	}
	const section = document.createElement('div');
	section.dataset.workSection = key;
	main.insertBefore(section, main.firstChild);
	return section;
}

function applyWorkSplit(pageSplitWork: number): void {
	const main1 = document.getElementById('blemmy-main-1');
	const main2 = document.getElementById('blemmy-main-2');
	if (!(main1 instanceof HTMLElement) || !(main2 instanceof HTMLElement)) {
		return;
	}
	const sec1 = ensureSection(main1, '1');
	const sec2 = ensureSection(main2, '2');
	sec1.innerHTML = '';
	sec2.innerHTML = '';
	const wrappers = sortedWorkWrappers();
	for (let i = 0; i < wrappers.length; i++) {
		if (i < pageSplitWork) {
			sec1.appendChild(wrappers[i]);
		} else {
			sec2.appendChild(wrappers[i]);
		}
	}
}

export function applyLayoutSnapshotToDom(snapshot: CVLayoutSnapshot): void {
	const card = document.getElementById('blemmy-card');
	const page2 = document.getElementById('blemmy-page-2');
	if (!(card instanceof HTMLElement) || !(page2 instanceof HTMLElement)) {
		return;
	}
	card.style.setProperty('--blemmy-sidebar-width-override', `${snapshot.sidebarMm}mm`);
	card.classList.remove('blemmy-density-1', 'blemmy-density-2', 'blemmy-density-3');
	card.classList.remove('blemmy-fill-1', 'blemmy-fill-2', 'blemmy-fill-3');
	if (snapshot.density > 0) {
		card.classList.add(`blemmy-density-${snapshot.density}`);
	}
	if (snapshot.fill > 0) {
		card.classList.add(`blemmy-fill-${snapshot.fill}`);
	}
	card.classList.toggle('blemmy-single-page', snapshot.pages === 1);
	page2.style.display = snapshot.pages === 1 ? 'none' : '';
	setFooterCols('blemmy-page-1-body-footer', snapshot.p1FooterCols);
	setFooterCols('blemmy-page-2-body-footer', snapshot.p2FooterCols);
	applyMastheadMode(snapshot.mastheadMode);
	applySectionPlacements(snapshot.sections);
	applyWorkSplit(snapshot.pageSplitWork);
	card.dataset.blemmyLayoutHeaderVariant = snapshot.mastheadMode;
	card.dataset.blemmyLayoutSections = JSON.stringify(snapshot.sections);
	card.dataset.blemmyLayoutWorkSplit = String(snapshot.pageSplitWork);
	card.dataset.blemmyLayoutPages = String(snapshot.pages);
	card.dataset.blemmyLayoutDisposition =
		snapshot.pages === 1 ? 'single-page' : 'two-page';
	card.setAttribute('data-blemmy-layout-ready', 'true');
}
