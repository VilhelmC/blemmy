import { expect, test } from './test-base';

test.describe('embed modes', () => {
	test('normal mode keeps authoring chrome visible', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('#cv-shell')).toBeVisible();
		await expect(page.locator('#cv-ui-dock-left-anchor')).toBeVisible();
		await expect(page.locator('#cv-ui-dock-right-anchor')).toBeVisible();
		await expect(page.locator('#cv-download-pdf')).toBeVisible();
	});

	test('portfolio embed hides authoring chrome', async ({ page }) => {
		await page.goto('/?cv-portfolio=1');
		await expect(page.locator('#cv-shell')).toBeVisible();
		await expect(page.locator('#cv-ui-dock-left-anchor')).toBeHidden();
		await expect(page.locator('#cv-ui-dock-right-anchor')).toBeHidden();
		await expect(page.locator('#cv-download-pdf')).toBeHidden();
		await expect(page.locator('.cv-share-footer__about')).toHaveText('Open full demo');
		await expect(page.locator('.cv-share-footer__about')).toHaveAttribute(
			'href',
			'https://blemmy.dev/',
		);
	});

	test('iframe embedding auto-enables portfolio embed mode', async ({ page }) => {
		await page.goto('/');
		await page.setContent(
			'<iframe id="embed" src="/" style="width:1100px;height:1200px;border:0"></iframe>',
		);
		const frame = page.frameLocator('#embed');
		await expect(frame.locator('#cv-shell')).toBeVisible();
		await expect(frame.locator('html')).toHaveClass(/cv-portfolio-embed/);
		await expect(frame.locator('#cv-ui-dock-left-anchor')).toBeHidden();
	});

	test('published embed query applies readonly class', async ({ page }) => {
		await page.goto('/?cv-embed-share=invalid-token-for-ui-check');
		await expect(page.locator('html')).toHaveClass(/cv-published-embed/);
		await expect(page.locator('html')).toHaveClass(/cv-share-readonly/);
	});

	test('portfolio embed stays minimal on mobile viewport', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('/?cv-portfolio=1');
		await expect(page.locator('#cv-shell')).toBeVisible();
		await expect(page.locator('#cv-ui-dock-left-anchor')).toBeHidden();
		await expect(page.locator('#cv-ui-dock-right-anchor')).toBeHidden();
		await expect(page.locator('.cv-share-footer__about')).toBeVisible();
	});
});
