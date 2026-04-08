/**
 * test-layout-determinism.mjs
 *
 * Replays captured audit snapshots and verifies layout winner metadata is
 * stable across repeated reloads for identical CV input state.
 */
import { createServer } from 'http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const docsDir = join(root, 'docs', 'reports');
const tracePath = join(docsDir, 'layout-audit-trace.json');
const reportPath = join(docsDir, 'layout-determinism-report.json');

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

async function readMeta(page) {
	return page.evaluate(() => {
		const c = document.getElementById('blemmy-card');
		return {
			pages: c?.dataset.blemmyLayoutPages ?? '',
			disposition: c?.dataset.blemmyLayoutDisposition ?? '',
			winnerId: c?.dataset.blemmyLayoutWinnerId ?? '',
			sidebarMm: c?.dataset.blemmyLayoutSidebarMm ?? '',
			split: c?.dataset.blemmyLayoutWorkSplit ?? '',
			density: c?.dataset.blemmyLayoutDensity ?? '',
		};
	});
}

function key(meta) {
	return JSON.stringify(meta);
}

async function run() {
	if (!existsSync(tracePath)) {
		throw new Error(
			'Missing docs/reports/layout-audit-trace.json. Run audit-layout-edit-sequences first.',
		);
	}
	const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
	const snapshots = (trace.trace ?? [])
		.filter((t) => t?.cv && typeof t.cv === 'object');
	const { server, port } = await startStaticServer(0);
	const baseUrl = `http://127.0.0.1:${port}/?cv-pdf=1`;
	const puppeteer = await import('puppeteer');
	const browser = await puppeteer.default.launch({ headless: true });
	const page = await browser.newPage();
	await page.setViewport({ width: 1500, height: 2100, deviceScaleFactor: 1 });

	const results = [];
	for (const snap of snapshots) {
		const runs = [];
		for (let i = 0; i < 3; i++) {
			await page.evaluateOnNewDocument((payload) => {
				localStorage.setItem('cv-user-data', JSON.stringify(payload));
				localStorage.removeItem('cv-app-session-state');
				localStorage.removeItem('cv-edit-draft');
				localStorage.removeItem('cv-layout-prefs');
			}, snap.cv);
			await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
			await page.waitForFunction(
				() => document.querySelector('#blemmy-card')?.getAttribute('data-blemmy-layout-ready') === 'true',
				{ timeout: 30000 },
			);
			runs.push(await readMeta(page));
		}
		const unique = new Set(runs.map((r) => key(r)));
		results.push({
			step: snap.step,
			consistent: unique.size === 1,
			runs,
		});
	}

	await browser.close();
	server.close();

	const report = {
		generatedAt: new Date().toISOString(),
		total: results.length,
		inconsistent: results.filter((r) => !r.consistent).map((r) => r.step),
		results,
	};
	if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
	writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.log('Wrote', reportPath);
	if (report.inconsistent.length > 0) process.exitCode = 1;
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});

