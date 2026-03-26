import { expect, test } from './test-base';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function reviewUrl(): string {
	return '/share/debug-share?cv-review=1';
}

async function mockShareResolve(page: import('@playwright/test').Page): Promise<void> {
	const cvJsonPath = join(process.cwd(), 'src', 'data', 'cv-content.json');
	const cvData = JSON.parse(await readFile(cvJsonPath, 'utf8'));
	await page.route('**/rpc/resolve_document_share**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([
				{
					document_id: 'doc-test',
					document_name: 'Debug Share',
					expires_at: '2099-01-01T00:00:00.000Z',
					data: cvData,
				},
			]),
		});
	});
}

test.describe('shared review mode layout', () => {
	test('desktop: shared review keeps page content within shell width', async ({ page }) => {
		await mockShareResolve(page);
		await page.setViewportSize({ width: 1280, height: 920 });
		await page.goto(reviewUrl());
		await expect(page.locator('#blemmy-review-panel')).toBeVisible();

		const widths = await page.evaluate(() => {
			const shell = document.getElementById('cv-shell');
			const card = document.getElementById('cv-card');
			const page1 = document.getElementById('cv-page-1');
			return {
				shell: shell?.getBoundingClientRect().width ?? 0,
				card: card?.getBoundingClientRect().width ?? 0,
				page1: page1?.getBoundingClientRect().width ?? 0,
			};
		});

		const epsilon = 1.5;
		expect(widths.shell).toBeGreaterThan(0);
		expect(widths.card).toBeLessThanOrEqual(widths.shell + epsilon);
		expect(widths.page1).toBeLessThanOrEqual(widths.shell + epsilon);
	});

	test('mobile: shared review renders as bottom sheet and preserves page scroll', async ({ page }) => {
		await mockShareResolve(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(reviewUrl());
		const reviewToggle = page.locator('#blemmy-review-toggle');
		await expect(reviewToggle).toBeVisible();
		await reviewToggle.click();
		const panel = page.locator('#blemmy-review-panel');
		await expect(panel).toBeVisible();

		const mobileState = await page.evaluate(() => {
			const panelEl = document.getElementById('blemmy-review-panel');
			if (!panelEl) {
				return { hasPanel: false, panelBottom: '', bodyPaddingBottom: '', canScroll: false };
			}
			const styles = window.getComputedStyle(panelEl);
			const bodyStyles = window.getComputedStyle(document.body);
			return {
				hasPanel: true,
				panelBottom: styles.bottom,
				bodyPaddingBottom: bodyStyles.paddingBottom,
				canScroll:
					document.documentElement.scrollHeight
					> document.documentElement.clientHeight,
			};
		});

		expect(mobileState.hasPanel).toBe(true);
		expect(mobileState.panelBottom).toBe('0px');
		expect(Number.parseFloat(mobileState.bodyPaddingBottom)).toBeGreaterThan(0);
		expect(mobileState.canScroll).toBe(true);
	});
});
