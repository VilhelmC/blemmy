import { expect, test } from '@playwright/test';

test.describe('chat context routing scope selection', () => {
	test('assistant scope chips track selected content blocks', async ({ page }) => {
		await page.goto('/');
		await page.locator('#blemmy-chat-trigger').click();

		const firstField = page.locator('[data-blemmy-field="basics.name"]');
		await firstField.click();

		const chip = page.locator('.blemmy-chat-scope-chip').first();
		await expect(chip).toBeVisible();
		await expect(firstField).toHaveClass(/blemmy-chat-scope-selected/);

		await chip.click();
		await expect(page.locator('.blemmy-chat-scope-chip')).toHaveCount(0);
	});
});

