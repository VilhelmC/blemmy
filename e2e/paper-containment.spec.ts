import { expect, test } from './test-base';
import {
	measurePaperContainment,
	waitForCvLayoutReady,
} from './helpers/paper-containment';

async function expandPeekDocksIfNeeded(page: import('@playwright/test').Page): Promise<void> {
	for (const side of ['left', 'right'] as const) {
		const handle = page.locator(`#cv-ui-dock-${side}-handle`);
		if (!await handle.isVisible()) {
			continue;
		}
		const dock = page.locator(`#cv-ui-dock-${side}`);
		const expanded = await dock.evaluate((el) =>
			el.classList.contains('cv-ui-dock--expanded'),
		);
		if (!expanded) {
			await handle.click();
		}
	}
}

async function clickDockControl(
	page: import('@playwright/test').Page,
	id: string,
	mobileLabel: string,
): Promise<void> {
	await expandPeekDocksIfNeeded(page);
	const direct = page.locator(`#${id}:visible`).first();
	if (await direct.count()) {
		await direct.click();
		return;
	}
	const mobile = await page.evaluate(() =>
		document.documentElement.classList.contains('cv-mobile-utility-active'),
	);
	if (!mobile) {
		await page.locator(`#${id}`).first().click();
		return;
	}
	const more = page.locator('#cv-mobile-utility-bar button:has-text("More")').first();
	if (await more.isVisible()) {
		await more.click();
	}
	await page.locator(
		`#cv-mobile-utility-bar button:has-text("${mobileLabel}"), ` +
			`#cv-mobile-utility-sheet button:has-text("${mobileLabel}")`,
	).first().click();
}

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
		`${hint}: ${report.violationCount} descendant(s) of #cv-shell extend past ` +
			`the shell left/right (samples: ${JSON.stringify(report.violations.slice(0, 8))}` +
			(report.truncated ? ', …' : '') +
			`)`,
	).toBe(0);
}

test.describe('paper containment (#cv-shell)', () => {
	test('baseline: no descendant extends outside shell', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(page.locator('#cv-shell')).toBeVisible();
		await waitForCvLayoutReady(page);

		const report = await measurePaperContainment(page);
		assertNoPaperOverflow(report, 'baseline');
	});

	test('assistant panel open (desktop)', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);

		await clickDockControl(page, 'cv-chat-trigger', 'Assistant');
		await expect(page.locator('#cv-chat-panel')).toBeVisible();
		await waitForCvLayoutReady(page);

		const report = await measurePaperContainment(page);
		assertNoPaperOverflow(report, 'chat open');
	});

	test('edit mode + hidden panel (desktop)', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForCvLayoutReady(page);
		await expandPeekDocksIfNeeded(page);

		await clickDockControl(page, 'cv-edit-btn', 'Edit');
		await expect(page.locator('#cv-edit-btn')).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('#cv-edit-panel')).toHaveCount(1);
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
		await clickDockControl(page, 'cv-chat-trigger', 'Assistant');
		await expect(page.locator('#cv-chat-panel')).toBeVisible();

		for (const w of [1100, 960, 920, 1280]) {
			await page.setViewportSize({ width: w, height: 900 });
			await waitForCvLayoutReady(page);
			const report = await measurePaperContainment(page);
			assertNoPaperOverflow(report, `chat open width ${w}`);
		}
	});
});
