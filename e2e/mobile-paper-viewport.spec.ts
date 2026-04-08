import type { Page } from '@playwright/test';
import { expect, test } from './test-base';

/** Layout + delayed paper refit (rAF + 120ms). */
async function waitForPaperStable(page: Page): Promise<void> {
	await page.waitForFunction(
		() => document.getElementById('blemmy-card')?.getAttribute('data-blemmy-layout-ready') === 'true',
		{ timeout: 60_000 },
	);
	await page.waitForTimeout(250);
}

type FitReport = {
	innerW: number;
	vvW: number;
	docScrollW: number;
	docClientW: number;
	stageRight: number | null;
	scalerRight: number | null;
};

async function measurePaperFit(page: Page): Promise<FitReport> {
	return page.evaluate(() => {
		const vv = window.visualViewport;
		const doc = document.documentElement;
		const stage = document.querySelector('.blemmy-paper-stage');
		const scaler = document.querySelector('.blemmy-paper-scaler');
		return {
			innerW: window.innerWidth,
			vvW: vv?.width ?? window.innerWidth,
			docScrollW: doc.scrollWidth,
			docClientW: doc.clientWidth,
			stageRight: stage ? stage.getBoundingClientRect().right : null,
			scalerRight: scaler ? scaler.getBoundingClientRect().right : null,
		};
	});
}

test.describe('mobile paper viewport', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('paper stage stays within viewport after layout', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('#blemmy-doc-shell')).toBeVisible();
		await waitForPaperStable(page);

		const r = await measurePaperFit(page);
		const limit = Math.ceil(r.vvW) + 4;

		expect(
			r.docScrollW,
			`document scrollWidth ${r.docScrollW} should not exceed clientWidth ${r.docClientW} by much`,
		).toBeLessThanOrEqual(r.docClientW + 4);

		if (r.stageRight != null) {
			expect(
				r.stageRight,
				`.blemmy-paper-stage right ${r.stageRight} vs vv.width ${r.vvW}`,
			).toBeLessThanOrEqual(limit);
		}
		if (r.scalerRight != null) {
			expect(
				r.scalerRight,
				`.blemmy-paper-scaler right ${r.scalerRight} vs vv.width ${r.vvW}`,
			).toBeLessThanOrEqual(limit);
		}
	});

	test('paper still fits after filter chip toggle when bar is visible', async ({
		page,
	}) => {
		await page.goto('/');
		await expect(page.locator('#blemmy-doc-shell')).toBeVisible();
		await waitForPaperStable(page);

		const bar = page.locator('#blemmy-filter-bar');
		const firstChip = bar.locator('[data-tag]').first();
		if (!(await bar.isVisible()) || !(await firstChip.isVisible())) {
			test.skip();
			return;
		}

		await firstChip.click();
		await waitForPaperStable(page);

		const r = await measurePaperFit(page);
		const limit = Math.ceil(r.vvW) + 4;

		expect(r.docScrollW).toBeLessThanOrEqual(r.docClientW + 4);
		if (r.stageRight != null) {
			expect(r.stageRight).toBeLessThanOrEqual(limit);
		}
		if (r.scalerRight != null) {
			expect(r.scalerRight).toBeLessThanOrEqual(limit);
		}
	});
});
