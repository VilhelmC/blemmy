import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, test } from './test-base';

const letterDemoPath = join(
	fileURLToPath(dirname(import.meta.url)),
	'..',
	'src',
	'data',
	'letter-demo.json',
);

async function waitForLayoutReady(page: import('@playwright/test').Page): Promise<void> {
	await page.waitForFunction(
		() => document.getElementById('blemmy-card')?.getAttribute('data-blemmy-layout-ready') === 'true',
		{ timeout: 60_000 },
	);
}

async function waitForDocumentRendered(
	page: import('@playwright/test').Page,
): Promise<void> {
	await page.waitForFunction(
		() => Boolean(document.getElementById('blemmy-doc-shell'))
			&& Boolean(document.getElementById('blemmy-card')),
		{ timeout: 60_000 },
	);
}

test.describe('letter session persistence', () => {
	test('reload restores active letter and edited content', async ({ page }) => {
		const letterRaw = await readFile(letterDemoPath, 'utf8');
		await page.goto('/');
		await expect(page.locator('#blemmy-doc-shell')).toBeVisible();
		await waitForLayoutReady(page);

		await page.evaluate((raw) => {
			const seed = JSON.parse(raw) as Record<string, unknown>;
			window.__blemmyRemountDocument__?.(seed, 'letter');
			const current = window.__blemmyDocument__ as Record<string, unknown> | undefined;
			if (!current) { throw new Error('Letter data missing'); }
			const next = {
				...current,
				opening: 'Dear QA Team,',
				body: [{ text: 'This is a persisted letter body paragraph.' }],
				recipient: {
					...(current.recipient as object),
					name: 'QA Receiver',
				},
				closing: {
					...(current.closing as object),
					salutation: 'Kind regards,',
					name: 'Blemmy QA',
				},
			};
			window.__blemmyRemountDocument__?.(next, 'letter');
		}, letterRaw);

		await expect(page.locator('[data-blemmy-field="opening"]')).toContainText('Dear QA Team,');
		await expect(page.locator('[data-blemmy-field="recipient.name"]')).toContainText('QA Receiver');
		await expect(page.locator('[data-blemmy-field="closing.salutation"]')).toContainText('Kind regards,');
		await page.reload();
		await expect(page.locator('#blemmy-doc-shell')).toBeVisible();
		await waitForDocumentRendered(page);

		await page.waitForFunction(() => window.__blemmyDocumentType__ === 'letter');
		await expect(page.locator('[data-blemmy-field="opening"]')).toContainText('Dear QA Team,');
		await expect(page.locator('[data-blemmy-field="recipient.name"]')).toContainText('QA Receiver');
		await expect(page.locator('[data-blemmy-field="closing.salutation"]')).toContainText('Kind regards,');
		await expect(page.locator('[data-blemmy-field="body.0.text"]')).toContainText(
			'This is a persisted letter body paragraph.',
		);
	});

	test('assistant copy is letter-aware in letter mode', async ({ page }) => {
		const letterRaw = await readFile(letterDemoPath, 'utf8');
		await page.goto('/');
		await expect(page.locator('#blemmy-doc-shell')).toBeVisible();
		await waitForLayoutReady(page);

		await page.evaluate((raw) => {
			const seed = JSON.parse(raw);
			window.__blemmyRemountDocument__?.(seed, 'letter');
		}, letterRaw);
		await page.waitForFunction(() => window.__blemmyDocumentType__ === 'letter');

		await page.locator('#blemmy-chat-trigger').click();
		await expect(page.locator('#blemmy-chat-panel')).toBeVisible();
		await expect(page.locator('#blemmy-chat-header-title')).toHaveText('Letter Assistant');
		await expect(page.locator('#blemmy-chat-input')).toHaveAttribute(
			'placeholder',
			'Ask about this letter…',
		);
	});
});
