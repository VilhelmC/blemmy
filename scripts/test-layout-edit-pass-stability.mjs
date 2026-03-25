/**
 * test-layout-edit-pass-stability.mjs
 *
 * Ensures edit-mode hide/show actions do not produce drift between the
 * immediate layout pass and the follow-up pass after edit-mode reactivation.
 */
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');

const MIME = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.ico': 'image/x-icon',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.woff': 'font/woff',
};

function ensureDist() {
	if (!existsSync(distDir)) {
		const r = spawnSync('npm', ['run', 'build'], {
			cwd: root,
			stdio: 'inherit',
			shell: true,
		});
		if (r.status !== 0) throw new Error('vite build failed');
	}
}

function startStaticServer(port) {
	const distResolved = resolve(distDir);
	return new Promise((resolvePromise) => {
		const server = createServer((req, res) => {
			let pathname = req.url?.split('?')[0] || '/';
			if (pathname === '/') pathname = '/index.html';
			const relative = pathname.replace(/^\//, '') || 'index.html';
			const filePath = join(distResolved, relative);
			const normalized = resolve(filePath);
			if (!normalized.startsWith(distResolved)) {
				res.statusCode = 403;
				res.end();
				return;
			}
			let servePath = filePath;
			if (existsSync(filePath) && statSync(filePath).isDirectory()) {
				servePath = join(filePath, 'index.html');
			}
			if (!existsSync(servePath) || !statSync(servePath).isFile()) {
				res.statusCode = 404;
				res.end();
				return;
			}
			const ext = servePath.slice(servePath.lastIndexOf('.'));
			res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
			res.end(readFileSync(servePath));
		});
		server.listen(port, '127.0.0.1', () => {
			const addr = server.address();
			const actualPort = typeof addr === 'object' && addr ? addr.port : port;
			resolvePromise({ server, port: actualPort });
		});
	});
}

async function waitLayoutReady(page) {
	await page.waitForFunction(
		() => document.querySelector('#cv-card')?.getAttribute('data-cv-layout-ready') === 'true',
		{ timeout: 30000 },
	);
}

async function readMeta(page) {
	return page.evaluate(() => {
		const c = document.getElementById('cv-card');
		return {
			pages: c?.dataset.cvPages ?? '',
			winnerId: c?.dataset.cvWinnerId ?? '',
			scoredTotal: c?.dataset.cvScoredTotal ?? '',
			scoredSingle: c?.dataset.cvScoredSingle ?? '',
			scoredTwo: c?.dataset.cvScoredTwo ?? '',
		};
	});
}

function sameMeta(a, b) {
	return (
		a.pages === b.pages &&
		a.winnerId === b.winnerId &&
		a.scoredTotal === b.scoredTotal &&
		a.scoredSingle === b.scoredSingle &&
		a.scoredTwo === b.scoredTwo
	);
}

async function performActionAndReadTwoPasses(page, actionLabel, actionFn) {
	await actionFn();
	await waitLayoutReady(page);
	const first = await readMeta(page);
	await new Promise((resolve) => setTimeout(resolve, 900));
	await waitLayoutReady(page);
	const second = await readMeta(page);
	if (!sameMeta(first, second)) {
		throw new Error(
			`${actionLabel}: second pass drift detected\n` +
			`first=${JSON.stringify(first)}\nsecond=${JSON.stringify(second)}`,
		);
	}
}

async function main() {
	ensureDist();
	const { server, port } = await startStaticServer(0);
	const baseUrl = `http://127.0.0.1:${port}/?debug-layout=1`;
	const puppeteer = await import('puppeteer');
	const browser = await puppeteer.default.launch({ headless: true });
	const page = await browser.newPage();
	await page.setViewport({ width: 1500, height: 2100, deviceScaleFactor: 1 });
	await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
	await waitLayoutReady(page);

	await page.click('#cv-edit-btn');
	await page.waitForSelector('[data-work-idx] .cv-vis-toggle', { timeout: 15000 });

	await performActionAndReadTwoPasses(page, 'hide-work', async () => {
		await page.click('[data-work-idx] .cv-vis-toggle');
	});
	await performActionAndReadTwoPasses(page, 'show-work', async () => {
		await page.click('#cv-edit-panel [data-panel-type="work"] .cv-edit-panel__restore');
	});

	await browser.close();
	server.close();
	console.log('Edit pass stability check passed');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

