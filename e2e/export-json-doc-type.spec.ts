import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const letterDemoPath = join(
	fileURLToPath(dirname(import.meta.url)),
	'..',
	'src',
	'data',
	'letter-demo.json',
);

async function triggerDownload(page: Page): Promise<Download> {
	const downloadPromise = page.waitForEvent('download');
	await page.evaluate(() => {
		const btn = document.getElementById('blemmy-download-json');
		if (!(btn instanceof HTMLButtonElement)) {
			throw new Error('Missing #blemmy-download-json button');
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

	// Letter export path
	const letterRaw = await readFile(letterDemoPath, 'utf8');
	await page.evaluate((raw) => {
		const data = JSON.parse(raw);
		const remount = (
			window as Window & {
				__blemmyRemountDocument__?: (d: unknown, t: string) => void;
			}
		).__blemmyRemountDocument__;
		if (!remount) {
			throw new Error('Missing __blemmyRemountDocument__ hook');
		}
		remount(data, 'letter');
	}, letterRaw);

	const letterDownload = await triggerDownload(page);
	const letterJson = await readDownloadedJson(letterDownload) as Record<string, unknown>;
	expect(letterJson.docType).toBe('letter');
});

