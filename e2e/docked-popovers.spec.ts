import { expect, test } from './test-base';

async function openDockControl(
	page: import('@playwright/test').Page,
	triggerId: string,
): Promise<void> {
	const trigger = page.locator(`#${triggerId}`);
	if (await trigger.isVisible()) {
		await trigger.click();
		return;
	}
	for (const side of ['left', 'right'] as const) {
		const handle = page.locator(`#cv-ui-dock-${side}-handle`);
		if (!await handle.isVisible()) { continue; }
		const dock = page.locator(`#cv-ui-dock-${side}`);
		const isExpanded = await dock.evaluate(
			(el) => el.classList.contains('cv-ui-dock--expanded'),
		);
		if (!isExpanded) { await handle.click(); }
	}
	await page.locator(`#${triggerId}`).click();
}

test.describe('docked popovers', () => {
	test('prefs and cloud close on outside click', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });

		await openDockControl(page, 'cv-prefs-trigger');
		await expect(page.locator('#cv-prefs-panel')).toBeVisible();
		await page.mouse.click(12, 12);
		await expect(page.locator('#cv-prefs-panel')).toBeHidden();

		await openDockControl(page, 'cv-cloud-trigger');
		await expect(page.locator('#cv-cloud-drawer')).toBeVisible();
		await page.mouse.click(12, 12);
		await expect(page.locator('#cv-cloud-drawer')).toBeHidden();
	});

	test('one-open-at-a-time across docked popovers', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1280, height: 900 });

		await openDockControl(page, 'cv-prefs-trigger');
		await expect(page.locator('#cv-prefs-panel')).toBeVisible();

		await openDockControl(page, 'cv-cloud-trigger');
		await expect(page.locator('#cv-cloud-drawer')).toBeVisible();
		await expect(page.locator('#cv-prefs-panel')).toBeHidden();

		await openDockControl(page, 'cv-chat-trigger');
		await expect(page.locator('#cv-chat-panel')).toBeVisible();
		// Cloud is a left-edge docked popover; chat is right-edge side panel.
		// They can co-exist. One-open-at-a-time applies within the same edge group.
		await expect(page.locator('#cv-cloud-drawer')).toBeVisible();
	});

	test('prefs and cloud stay inside short viewport', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 1200, height: 520 });

		await openDockControl(page, 'cv-prefs-trigger');
		const prefsRect = await page.locator('#cv-prefs-panel').evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top, bottom: r.bottom };
		});
		expect(prefsRect.top).toBeGreaterThanOrEqual(0);
		expect(prefsRect.bottom).toBeLessThanOrEqual(520);

		await openDockControl(page, 'cv-cloud-trigger');
		const cloudRect = await page.locator('#cv-cloud-drawer').evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top, bottom: r.bottom };
		});
		expect(cloudRect.top).toBeGreaterThanOrEqual(0);
		expect(cloudRect.bottom).toBeLessThanOrEqual(520);
	});

	test('mobile utility sheet can open prefs and cloud', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await page.setViewportSize({ width: 333, height: 532 });
		await expect(page.locator('#cv-mobile-utility-bar')).toBeVisible();

		await page.locator('#cv-mobile-utility-bar button:has-text("More")').click();
		await page.locator('#cv-mobile-utility-sheet button:has-text("Layout")')
			.click();
		// Proxied prefs open is deferred (setTimeout 0) after sheet closes.
		await expect(page.locator('#cv-prefs-panel')).toBeVisible({ timeout: 20_000 });

		await page.locator('#cv-mobile-utility-bar button:has-text("More")').click();
		await page.locator('#cv-mobile-utility-sheet button:has-text("Cloud")')
			.click();
		await expect(page.locator('#cv-cloud-drawer')).toBeVisible({ timeout: 20_000 });
		await expect(page.locator('#cv-prefs-panel')).toBeHidden();
	});

	test('prefs panel height stays stable while inner scrolling', async ({ page }) => {
		await page.goto('/');
		await page.setViewportSize({ width: 333, height: 532 });
		await page.locator('#cv-mobile-utility-bar button:has-text("More")').click();
		await page.locator('#cv-mobile-utility-sheet button:has-text("Layout")')
			.click();
		const panel = page.locator('#cv-prefs-panel');
		await expect(panel).toBeVisible();
		const h0 = await panel.evaluate((el) => el.getBoundingClientRect().height);
		await panel.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await page.waitForTimeout(150);
		const h1 = await panel.evaluate((el) => el.getBoundingClientRect().height);
		expect(Math.abs(h1 - h0)).toBeLessThanOrEqual(2);
	});
});
