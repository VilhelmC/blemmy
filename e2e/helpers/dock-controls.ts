import type { Page } from '@playwright/test';

/** Expand peek-collapsed docks so dock button ids are clickable on narrow viewports. */
export async function expandPeekDocksIfNeeded(page: Page): Promise<void> {
	for (const side of ['left', 'right'] as const) {
		const handle = page.locator(`#blemmy-ui-dock-${side}-handle`);
		if (!await handle.isVisible()) {
			continue;
		}
		const dock = page.locator(`#blemmy-ui-dock-${side}`);
		const expanded = await dock.evaluate((el) =>
			el.classList.contains('blemmy-ui-dock--expanded'),
		);
		if (!expanded) {
			await handle.click();
		}
	}
}

/**
 * Clicks a dock control by id, or the mobile utility sheet entry with
 * `mobileLabel` text when the compact bar is active.
 */
export async function clickDockControl(
	page: Page,
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
		document.documentElement.classList.contains('blemmy-mobile-utility-active'),
	);
	if (!mobile) {
		await page.locator(`#${id}`).first().click();
		return;
	}
	const more = page.locator('#blemmy-mobile-utility-bar button:has-text("More")').first();
	if (await more.isVisible()) {
		await more.click();
	}
	await page.locator(
		`#blemmy-mobile-utility-bar button:has-text("${mobileLabel}"), ` +
			`#blemmy-mobile-utility-sheet button:has-text("${mobileLabel}")`,
	).first().click();
}
