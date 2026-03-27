import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function triggerDownload(page: Page): Promise<Download> {
	const downloadPromise = page.waitForEvent('download');
	await page.evaluate(() => {
		const btn = document.getElementById('cv-download-json');
		if (!(btn instanceof HTMLButtonElement)) {
			throw new Error('Missing #cv-download-json button');
		}
		btn.click();
	});
	return downloadPromise;
}

async function readDownloadedJson(download: Download): Promise<unknown> {
	const filePath = await download.path();
	if (!filePath) {
		throw new Error('Download path unavailable');
	}
	const raw = await readFile(filePath, 'utf8');
	return JSON.parse(raw) as unknown;
}

test('download json includes active docType marker', async ({ page }) => {
	await page.goto('/');

	// CV export path
	const cvDownload = await triggerDownload(page);
	const cvJson = await readDownloadedJson(cvDownload) as Record<string, unknown>;
	expect(cvJson.docType).toBe('cv');

	// Letter export path (runtime switch hook from main.ts)
	await page.evaluate(() => {
		const switchToLetter = (
			window as Window & { __blemmySwitchToLetter__?: () => void }
		).__blemmySwitchToLetter__;
		if (!switchToLetter) {
			throw new Error('Missing __blemmySwitchToLetter__ hook');
		}
		switchToLetter();
	});

	const letterDownload = await triggerDownload(page);
	const letterJson = await readDownloadedJson(letterDownload) as Record<string, unknown>;
	expect(letterJson.docType).toBe('letter');
});

