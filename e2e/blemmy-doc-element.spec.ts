import { test, expect } from '@playwright/test';

test.describe('blemmy-doc custom element', () => {
	test('embed demo renders document shell', async ({ page }) => {
		await page.goto('/embed-demo.html');
		await expect(page.locator('blemmy-doc #blemmy-doc-shell')).toBeVisible({
			timeout: 20000,
		});
	});
});
