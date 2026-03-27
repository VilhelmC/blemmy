import { expect, test } from './test-base';

const CLOUD_EMAIL = process.env.E2E_CLOUD_EMAIL ?? '';
const CLOUD_PASSWORD = process.env.E2E_CLOUD_PASSWORD ?? '';

test.describe('embed cloud lifecycle', () => {
	test.skip(
		!CLOUD_EMAIL || !CLOUD_PASSWORD,
		'E2E_CLOUD_EMAIL and E2E_CLOUD_PASSWORD are required',
	);

	test('create and rotate embed link from share dialog', async ({ page }) => {
		await page.goto('/');

		await page.locator('#cv-cloud-trigger').click();
		await expect(page.locator('#cv-cloud-drawer')).toBeVisible();

		const expandAuth = page.locator('.cv-auth-expand');
		if (await expandAuth.isVisible()) {
			await expandAuth.click();
		}
		await page.locator('#cv-auth-email').fill(CLOUD_EMAIL);
		await page.locator('#cv-auth-password').fill(CLOUD_PASSWORD);
		const authConsent = page.locator('#cv-auth-policy-accept');
		if (await authConsent.isVisible()) {
			await authConsent.check();
		}
		await page.locator('#cv-auth-submit').click();

		await expect(page.locator('#cv-doc-list')).toBeVisible();
		await expect(page.locator('.cv-doc-row')).toHaveCount(1, { timeout: 15000 });
		await page.locator('.cv-doc-row .cv-doc-row__action:has-text("↗")').first().click();

		const modal = page.locator('.cv-share-modal__panel');
		await expect(modal).toBeVisible();
		await page.locator('.cv-share-modal__review-opt input[type="checkbox"]').nth(1).check();

		await page.locator('.cv-doc-btn:has-text("Create embed link")').click();
		await expect(page.locator('.cv-share-modal__status')).toContainText('Embed');

		await page.locator('.cv-doc-btn:has-text("Rotate embed link")').click();
		await expect(page.locator('.cv-share-modal__status')).toContainText('Embed');
	});
});
