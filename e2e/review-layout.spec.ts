import { expect, test } from './test-base';

async function ensureReviewOpen(page: import('@playwright/test').Page): Promise<void> {
	const reviewBtn = page.locator('#blemmy-review-toggle');
	await expect(reviewBtn).toBeVisible();
	const expanded = await reviewBtn.getAttribute('aria-expanded');
	if (expanded !== 'true') {
		await reviewBtn.click();
	}
	await expect(reviewBtn).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('#blemmy-review-panel')).toBeVisible();
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
		return {
			widths: { shell: shellW, card: cardW, page1: page1W },
			overflowPx: {
				card: Math.max(0, Math.ceil(cardW - shellW)),
				page1: Math.max(0, Math.ceil(page1W - shellW)),
			},
			mode: {
				printPreview: Boolean(shell?.classList.contains('cv-print-preview')),
				reviewModeClass: document.documentElement.classList.contains('blemmy-review-mode'),
			},
			panel: {
				hidden: Boolean(panel?.hasAttribute('hidden')),
				ariaExpanded: toggle?.getAttribute('aria-expanded') ?? null,
			},
		};
	});
}

function expectNoOverflow(widths: { shell: number; card: number; page1: number }): void {
	const epsilon = 1.5;
	expect(widths.shell).toBeGreaterThan(0);
	expect(widths.card).toBeLessThanOrEqual(widths.shell + epsilon);
	expect(widths.page1).toBeLessThanOrEqual(widths.shell + epsilon);
}

test.describe('review panel layout', () => {
	test('web view keeps cv card within shell across resize', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 920 });
		await ensureReviewOpen(page);
		expectNoOverflow(await readWidths(page));

		await page.setViewportSize({ width: 860, height: 920 });
		await page.setViewportSize({ width: 1200, height: 920 });
		await ensureReviewOpen(page);
		expectNoOverflow(await readWidths(page));
	});

	test('print view keeps cv card within shell with review panel open', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 920 });
		await page.getByRole('button', { name: 'Print view' }).click();
		await ensureReviewOpen(page);
		expectNoOverflow(await readWidths(page));

		await page.setViewportSize({ width: 900, height: 920 });
		await page.setViewportSize({ width: 1180, height: 920 });
		await ensureReviewOpen(page);
		expectNoOverflow(await readWidths(page));
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
		await pushTrace('initial-web-open');
		expectNoOverflow((await readDebugSnapshot(page)).widths);

		const widths = [1280, 1100, 980, 900, 840, 920, 1040, 1200];
		for (const w of widths) {
			await page.setViewportSize({ width: w, height: 900 });
			await ensureReviewOpen(page);
			await pushTrace(`web-resize-${w}`);
			expectNoOverflow((await readDebugSnapshot(page)).widths);
		}

		const reviewBtn = page.locator('#blemmy-review-toggle');
		await reviewBtn.click();
		await pushTrace('panel-closed');
		await reviewBtn.click();
		await ensureReviewOpen(page);
		await pushTrace('panel-reopened');
		expectNoOverflow((await readDebugSnapshot(page)).widths);

		await page.getByRole('button', { name: 'Print view' }).click();
		await ensureReviewOpen(page);
		await pushTrace('print-open');
		expectNoOverflow((await readDebugSnapshot(page)).widths);

		for (const w of [1180, 980, 860, 980, 1220]) {
			await page.setViewportSize({ width: w, height: 900 });
			await ensureReviewOpen(page);
			await pushTrace(`print-resize-${w}`);
			expectNoOverflow((await readDebugSnapshot(page)).widths);
		}

		await testInfo.attach('review-layout-stress-trace', {
			body: JSON.stringify(trace, null, 2),
			contentType: 'application/json',
		});
	});
});
