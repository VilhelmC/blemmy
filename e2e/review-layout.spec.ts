import { expect, test } from './test-base';

/** Narrow peek docks hide controls until expanded — must open before dock clicks. */
async function expandPeekDocksForDockClicks(
	page: import('@playwright/test').Page,
): Promise<void> {
	for (const side of ['left', 'right'] as const) {
		const handle = page.locator(`#cv-ui-dock-${side}-handle`);
		if (!await handle.isVisible()) { continue; }
		const dock = page.locator(`#cv-ui-dock-${side}`);
		const isEx = await dock.evaluate((el) => el.classList.contains('cv-ui-dock--expanded'));
		if (!isEx) { await handle.click(); }
	}
}

async function setPeekDockExpanded(
	page: import('@playwright/test').Page,
	side: 'left' | 'right',
	expanded: boolean,
): Promise<void> {
	const handle = page.locator(`#cv-ui-dock-${side}-handle`);
	if (!await handle.isVisible()) { return; }
	const dock = page.locator(`#cv-ui-dock-${side}`);
	const isEx = await dock.evaluate((el) => el.classList.contains('cv-ui-dock--expanded'));
	if (isEx !== expanded) { await handle.click(); }
}

async function clickControl(
	page: import('@playwright/test').Page,
	id: string,
	mobileLabel: string,
	fromMore = false,
): Promise<void> {
	await expandPeekDocksForDockClicks(page);
	const direct = page.locator(`#${id}:visible`).first();
	if (await direct.count()) {
		await direct.click();
		return;
	}
	const mobileActive = await page.evaluate(() =>
		document.documentElement.classList.contains('cv-mobile-utility-active'),
	);
	if (!mobileActive) {
		await page.locator(`#${id}`).first().click();
		return;
	}
	if (fromMore) {
		const moreBtn = page.locator(
			'#cv-mobile-utility-bar button:has-text("More")',
		).first();
		if (await moreBtn.isVisible()) { await moreBtn.click(); }
	}
	await page.locator(
		`#cv-mobile-utility-bar button:has-text("${mobileLabel}"), ` +
		`#cv-mobile-utility-sheet button:has-text("${mobileLabel}")`,
	).first().click();
}

async function ensureReviewOpen(page: import('@playwright/test').Page): Promise<void> {
	const reviewBtn = page.locator('#blemmy-review-toggle');
	if (!await reviewBtn.isVisible()) {
		await clickControl(page, 'blemmy-review-toggle', 'Review');
	}
	await expect(reviewBtn).toBeAttached();
	const expanded = await reviewBtn.getAttribute('aria-expanded');
	if (expanded !== 'true') {
		await clickControl(page, 'blemmy-review-toggle', 'Review');
	}
	await expect(reviewBtn).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('#blemmy-review-panel')).toBeVisible();
}

async function ensureChatClosed(page: import('@playwright/test').Page): Promise<void> {
	const chatBtn = page.locator('#cv-chat-trigger');
	if (!await chatBtn.isVisible()) {
		await clickControl(page, 'cv-chat-trigger', 'Assistant');
	}
	const panel = page.locator('#cv-chat-panel');
	if (await panel.isVisible()) {
		await page.locator('#cv-chat-close').click();
	}
	await expect(panel).toBeHidden();
}

async function ensureEditClosed(page: import('@playwright/test').Page): Promise<void> {
	const editBtn = page.locator('#cv-edit-btn');
	if (!await editBtn.isVisible()) {
		await clickControl(page, 'cv-edit-btn', 'Edit');
	}
	const pressed = await editBtn.getAttribute('aria-pressed');
	if (pressed === 'true') {
		await clickControl(page, 'cv-edit-btn', 'Edit');
	}
	await expect(editBtn).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('#cv-edit-panel')).toHaveCount(0);
}

async function readWidths(page: import('@playwright/test').Page): Promise<{
	shell: number;
	card: number;
	page1: number;
}> {
	return page.evaluate(() => {
		const shell = document.getElementById('cv-shell');
		const card = document.getElementById('cv-card');
		const page1 = document.getElementById('cv-page-1');
		return {
			shell: shell?.getBoundingClientRect().width ?? 0,
			card: card?.getBoundingClientRect().width ?? 0,
			page1: page1?.getBoundingClientRect().width ?? 0,
		};
	});
}

async function readDebugSnapshot(page: import('@playwright/test').Page): Promise<{
	widths: { shell: number; card: number; page1: number };
	overflowPx: { card: number; page1: number };
	gapPx: number;
	mode: { printPreview: boolean; reviewModeClass: boolean };
	panel: { hidden: boolean; ariaExpanded: string | null };
}> {
	return page.evaluate(() => {
		const shell = document.getElementById('cv-shell');
		const card = document.getElementById('cv-card');
		const page1 = document.getElementById('cv-page-1');
		const panel = document.getElementById('blemmy-review-panel');
		const toggle = document.getElementById('blemmy-review-toggle');
		const shellW = shell?.getBoundingClientRect().width ?? 0;
		const cardW = card?.getBoundingClientRect().width ?? 0;
		const page1W = page1?.getBoundingClientRect().width ?? 0;
		const page1Rect = page1?.getBoundingClientRect();
		const panelRect = panel?.getBoundingClientRect();
		const gapPx = page1Rect && panelRect
			? Math.round(panelRect.left - page1Rect.right)
			: 0;
		return {
			widths: { shell: shellW, card: cardW, page1: page1W },
			overflowPx: {
				card: Math.max(0, Math.ceil(cardW - shellW)),
				page1: Math.max(0, Math.ceil(page1W - shellW)),
			},
			gapPx,
			mode: {
				printPreview: Boolean(shell?.classList.contains('cv-print-preview')),
				reviewModeClass: document.documentElement.classList.contains('blemmy-review-mode'),
				desktopSideMode: window.matchMedia('(min-width: 901px)').matches,
			},
			panel: {
				hidden: Boolean(panel?.hasAttribute('hidden')),
				ariaExpanded: toggle?.getAttribute('aria-expanded') ?? null,
			},
		};
	});
}

async function readDockSnapshot(page: import('@playwright/test').Page): Promise<{
	leftExists: boolean;
	rightExists: boolean;
	historyIsColumn: boolean;
	compactButtons: Array<{ id: string; fontSizePx: number; hasIconAttr: boolean }>;
	titles: Record<string, string | null>;
	printFabInsideRightDock: boolean;
}> {
	return page.evaluate(() => {
		const leftDock = document.getElementById('cv-ui-dock-left');
		const rightDock = document.getElementById('cv-ui-dock-right');
		const history = document.getElementById('cv-history-controls');
		const compactIds = [
			'cv-layout-debug-toggle',
			'cv-prefs-trigger',
			'cv-upload-btn',
			'cv-download-json',
			'cv-edit-btn',
			'blemmy-review-toggle',
			'theme-toggle',
			'cv-chat-trigger',
			'cv-cloud-trigger',
		];
		const compactButtons = compactIds
			.map((id) => document.getElementById(id))
			.filter((el): el is HTMLElement => Boolean(el))
			.map((el) => ({
				id: el.id,
				fontSizePx: Number.parseFloat(window.getComputedStyle(el).fontSize),
				hasIconAttr: el.hasAttribute('data-icon'),
			}));
		const titleIds = [
			'cv-layout-debug-toggle',
			'theme-toggle',
			'cv-upload-btn',
			'cv-download-json',
			'cv-edit-btn',
			'cv-chat-trigger',
			'cv-cloud-trigger',
			'blemmy-review-toggle',
		];
		const titles: Record<string, string | null> = {};
		for (const id of titleIds) {
			titles[id] = document.getElementById(id)?.getAttribute('title') ?? null;
		}
		const printBtn = document.getElementById('cv-download-pdf');
		const printFabInsideRightDock = Boolean(
			printBtn && rightDock?.contains(printBtn),
		);
		return {
			leftExists: Boolean(leftDock),
			rightExists: Boolean(rightDock),
			historyIsColumn: window.getComputedStyle(history ?? document.body).flexDirection === 'column',
			compactButtons,
			titles,
			printFabInsideRightDock,
		};
	});
}

function expectNoOverflow(widths: { shell: number; card: number; page1: number }): void {
	const epsilon = 1.5;
	expect(widths.shell).toBeGreaterThan(0);
	expect(widths.card).toBeLessThanOrEqual(widths.shell + epsilon);
	expect(widths.page1).toBeLessThanOrEqual(widths.shell + epsilon);
}

function expectNoPanelOverlap(snapshot: {
	gapPx: number;
	mode: { desktopSideMode: boolean };
	panel: { hidden: boolean };
}): void {
	if (snapshot.panel.hidden || !snapshot.mode.desktopSideMode) { return; }
	expect(snapshot.gapPx).toBeGreaterThanOrEqual(0);
}

test.describe('review panel layout', () => {
	test('web view keeps cv card within shell across resize', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 920 });
		await ensureReviewOpen(page);
		const snapA = await readDebugSnapshot(page);
		expectNoOverflow(snapA.widths);
		expectNoPanelOverlap(snapA);

		await page.setViewportSize({ width: 860, height: 920 });
		await page.setViewportSize({ width: 1200, height: 920 });
		await ensureReviewOpen(page);
		const snapB = await readDebugSnapshot(page);
		expectNoOverflow(snapB.widths);
		expectNoPanelOverlap(snapB);
	});

	test('print view keeps cv card within shell with review panel open', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 920 });
		await expandPeekDocksForDockClicks(page);
		// Print / PDF surface is the default; web view toggle is not mounted.
		await ensureReviewOpen(page);
		const snapC = await readDebugSnapshot(page);
		expectNoOverflow(snapC.widths);
		expectNoPanelOverlap(snapC);

		await page.setViewportSize({ width: 900, height: 920 });
		await page.setViewportSize({ width: 1180, height: 920 });
		await ensureReviewOpen(page);
		const snapD = await readDebugSnapshot(page);
		expectNoOverflow(snapD.widths);
		expectNoPanelOverlap(snapD);
	});

	test('stress: resize + mode + panel toggles never overflow shell', async ({ page }, testInfo) => {
		const trace: Array<Record<string, unknown>> = [];
		const pushTrace = async (label: string): Promise<void> => {
			trace.push({
				label,
				viewport: page.viewportSize(),
				...(await readDebugSnapshot(page)),
			});
		};
		await page.goto('/');
		await page.setViewportSize({ width: 1365, height: 900 });
		await ensureReviewOpen(page);
		await pushTrace('initial-print-open');
		const initSnap = await readDebugSnapshot(page);
		expectNoOverflow(initSnap.widths);
		expectNoPanelOverlap(initSnap);

		const widths = [1280, 1100, 980, 900, 840, 920, 1040, 1200];
		for (const w of widths) {
			await page.setViewportSize({ width: w, height: 900 });
			await ensureReviewOpen(page);
			await pushTrace(`print-resize-${w}`);
			const s = await readDebugSnapshot(page);
			expectNoOverflow(s.widths);
			expectNoPanelOverlap(s);
		}

		await clickControl(page, 'blemmy-review-toggle', 'Review');
		await pushTrace('panel-closed');
		await clickControl(page, 'blemmy-review-toggle', 'Review');
		await ensureReviewOpen(page);
		await pushTrace('panel-reopened');
		const reopened = await readDebugSnapshot(page);
		expectNoOverflow(reopened.widths);
		expectNoPanelOverlap(reopened);

		await testInfo.attach('review-layout-stress-trace', {
			body: JSON.stringify(trace, null, 2),
			contentType: 'application/json',
		});
	});

	test('manual path: edit and chat transitions preserve review layout', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await ensureEditClosed(page);
		await ensureChatClosed(page);

		const editBtn = page.locator('#cv-edit-btn');
		await clickControl(page, 'cv-edit-btn', 'Edit');
		await expect(editBtn).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('#cv-edit-panel')).toHaveCount(1);
		await clickControl(page, 'cv-edit-btn', 'Edit');
		await ensureEditClosed(page);

		const chatBtn = page.locator('#cv-chat-trigger');
		await clickControl(page, 'cv-chat-trigger', 'Assistant');
		await expect(page.locator('#cv-chat-panel')).toBeVisible();
		await page.locator('#cv-chat-close').click();
		await ensureChatClosed(page);

		await ensureReviewOpen(page);
		let snap = await readDebugSnapshot(page);
		expectNoOverflow(snap.widths);
		expectNoPanelOverlap(snap);

		for (const width of [980, 860, 930, 1180, 900, 1240]) {
			await page.setViewportSize({ width, height: 900 });
			await ensureReviewOpen(page);
			snap = await readDebugSnapshot(page);
			expectNoOverflow(snap.widths);
			expectNoPanelOverlap(snap);
		}
	});

	test('docks: tooltips, compact icons, and print separation', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 980, height: 900 });
		await ensureReviewOpen(page);
		await setPeekDockExpanded(page, 'left', false);
		await setPeekDockExpanded(page, 'right', false);
		const dock = await readDockSnapshot(page);
		expect(dock.leftExists).toBe(true);
		expect(dock.rightExists).toBe(true);
		expect(dock.historyIsColumn).toBe(true);
		for (const item of dock.compactButtons) {
			expect(item.hasIconAttr).toBe(true);
			expect(item.fontSizePx).toBeLessThanOrEqual(1);
		}
		for (const [id, title] of Object.entries(dock.titles)) {
			expect(title, `${id} missing title`).not.toBeNull();
			expect((title ?? '').trim().length).toBeGreaterThan(0);
		}
		expect(dock.printFabInsideRightDock).toBe(true);
	});
});
