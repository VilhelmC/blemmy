import { expect, test } from '@playwright/test';

test.describe('chat context routing scope selection', () => {
	test('assistant scope chips track selected content blocks', async ({ page }) => {
		await page.goto('/');
		await page.locator('#cv-chat-trigger').click();

		const firstField = page.locator('[data-cv-field]').first();
		await firstField.click();

		const chip = page.locator('.cv-chat-scope-chip').first();
		await expect(chip).toBeVisible();
		await expect(firstField).toHaveClass(/cv-chat-scope-selected/);

		await chip.click();
		await expect(page.locator('.cv-chat-scope-chip')).toHaveCount(0);
	});
});

