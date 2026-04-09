import { expect, test } from './test-base';
import {
	measurePaperContainment,
	waitForCvLayoutReady,
} from './helpers/paper-containment';
import { clickDockControl, expandPeekDocksIfNeeded } from './helpers/dock-controls';

function assertNoPaperOverflow(
	report: Awaited<ReturnType<typeof measurePaperContainment>>,
	hint: string,
): void {
	expect(report.ok, `${hint}: measurement`).toBe(true);
	if (!report.ok) {
		return;
	}
	expect(
		report.violationCount,
		`${hint}: ${report.violationCount} descendant(s) of #blemmy-doc-shell extend past ` +
			`the shell left/right (samples: ${JSON.stringify(report.violations.slice(0, 8))}` +
			(report.truncated ? ', …' : '') +
			`)`,
	).toBe(0);
}

test.describe('paper containment (#blemmy-doc-shell)', () => {
	test('baseline: no descendant extends outside shell', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(page.locator('#blemmy-doc-shell')).toBeVisible();
		await waitForCvLayoutReady(page);

		const report = await measurePaperContainment(page);
		assertNoPaperOverflow(report, 'baseline');
	});

	test('assistant panel open (desktop)', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);

		await clickDockControl(page, 'blemmy-chat-trigger', 'Assistant');
		await expect(page.locator('#blemmy-chat-panel')).toBeVisible();
		await waitForCvLayoutReady(page);

		const report = await measurePaperContainment(page);
		assertNoPaperOverflow(report, 'chat open');
	});

	test('edit mode + hidden panel (desktop)', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);

		await clickDockControl(page, 'blemmy-edit-btn', 'Edit');
		await expect(page.locator('#blemmy-edit-btn')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('#blemmy-edit-panel')).toHaveCount(1);
		await waitForCvLayoutReady(page);

		const report = await measurePaperContainment(page);
		assertNoPaperOverflow(report, 'edit mode');
	});

	test('review panel open (desktop)', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);

		const toggle = page.locator('#blemmy-review-toggle');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('#blemmy-review-panel')).toBeVisible();
		await waitForCvLayoutReady(page);

		const report = await measurePaperContainment(page);
		assertNoPaperOverflow(report, 'review open');
	});

	test('narrow column after resize still contains descendants', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);
		await clickDockControl(page, 'blemmy-chat-trigger', 'Assistant');
		await expect(page.locator('#blemmy-chat-panel')).toBeVisible();

		for (const w of [1100, 960, 920, 1280]) {
			await page.setViewportSize({ width: w, height: 900 });
			await waitForCvLayoutReady(page);
			const report = await measurePaperContainment(page);
			assertNoPaperOverflow(report, `chat open width ${w}`);
		}
	});
});
