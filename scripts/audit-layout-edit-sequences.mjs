/**
 * audit-layout-edit-sequences.mjs
 *
 * Runs reproducible edit-mode scenarios and captures layout metadata/state.
 * Output: docs/reports/layout-audit-trace.json
 */
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const docsDir = join(root, 'docs', 'reports');
const reportPath = join(docsDir, 'layout-audit-trace.json');
const baseData = JSON.parse(readFileSync(join(root, 'src', 'data', 'cv-demo.json'), 'utf8'));

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

function hashString(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

async function installLayoutCounter(page) {
	await page.evaluate(() => {
		const w = window;
		if (typeof w.__layoutAppliedCount !== 'number') {
			w.__layoutAppliedCount = 0;
			window.addEventListener('blemmy-layout-applied', () => {
				w.__layoutAppliedCount += 1;
			});
		}
	});
}

async function readLayoutCounter(page) {
	return page.evaluate(() => window.__layoutAppliedCount ?? 0);
}

async function waitNextLayout(page, prevCount) {
	await page.waitForFunction((p) => (window.__layoutAppliedCount ?? 0) > p, {
		timeout: 15000,
	}, prevCount);
}

async function waitLayoutReady(page) {
	await page.waitForFunction(
		() => document.querySelector('#blemmy-card')?.getAttribute('data-blemmy-layout-ready') === 'true',
		{ timeout: 30000 },
	);
}

async function readSnapshot(page, step) {
	return page.evaluate((label) => {
		const card = document.getElementById('blemmy-card');
		const cv = window.__CV_DATA__ ?? null;
		const json = cv ? JSON.stringify(cv) : '';
		return {
			step: label,
			stateHash: json ? (window.__hashString ? window.__hashString(json) : json.length) : null,
			card: {
				pages: card?.dataset.blemmyLayoutPages ?? '',
				disposition: card?.dataset.blemmyLayoutDisposition ?? '',
				winnerId: card?.dataset.blemmyLayoutWinnerId ?? '',
				sidebarMm: card?.dataset.blemmyLayoutSidebarMm ?? '',
				split: card?.dataset.blemmyLayoutWorkSplit ?? '',
				density: card?.dataset.blemmyLayoutDensity ?? '',
				layoutMs: card?.dataset.blemmyLayoutMs ?? '',
			},
			visibility: cv?.visibility ?? {},
			cv,
			workCount: Array.isArray(cv?.work) ? cv.work.length : 0,
		};
	}, step);
}

async function main() {
	ensureDist();
	const { server, port } = await startStaticServer(0);
	const baseUrl = `http://127.0.0.1:${port}/?cv-pdf=1&debug-layout=1`;
	const puppeteer = await import('puppeteer');
	const browser = await puppeteer.default.launch({ headless: true });
	const page = await browser.newPage();
	await page.setViewport({ width: 1500, height: 2100, deviceScaleFactor: 1 });
	await page.evaluateOnNewDocument((payload) => {
		localStorage.setItem('cv-user-data', JSON.stringify(payload));
		localStorage.removeItem('cv-edit-draft');
		localStorage.removeItem('cv-app-session-state');
		localStorage.removeItem('cv-layout-prefs');
		window.__hashString = (s) => {
			let h = 2166136261;
			for (let i = 0; i < s.length; i++) {
				h ^= s.charCodeAt(i);
				h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
			}
			return (h >>> 0).toString(16).padStart(8, '0');
		};
	}, baseData);
	await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
	await waitLayoutReady(page);
	await installLayoutCounter(page);

	const trace = [];
	trace.push(await readSnapshot(page, 'initial'));

	// Enter edit mode
	await page.click('#cv-edit-btn');
	await page.waitForSelector(
		'[data-blemmy-drag-group="work"] .cv-vis-toggle',
		{ timeout: 15000 },
	);
	trace.push(await readSnapshot(page, 'edit-mode-enabled'));

	// Hide first visible work item
	let n = await readLayoutCounter(page);
	await page.click('[data-blemmy-drag-group="work"] .cv-vis-toggle');
	await waitNextLayout(page, n);
	await waitLayoutReady(page);
	trace.push(await readSnapshot(page, 'hide-first-work'));

	// Unhide from panel
	n = await readLayoutCounter(page);
	await page.click('#cv-edit-panel [data-panel-type="work"] .cv-edit-panel__restore');
	await waitNextLayout(page, n);
	await waitLayoutReady(page);
	trace.push(await readSnapshot(page, 'unhide-first-work'));

	// Reorder first/second items (programmatic reorder for determinism replay)
	await page.evaluate(() => {
		const cv = window.__CV_DATA__;
		if (!cv || !Array.isArray(cv.work) || cv.work.length < 2) { return; }
		const next = JSON.parse(JSON.stringify(cv));
		const tmp = next.work[0];
		next.work[0] = next.work[1];
		next.work[1] = tmp;
		localStorage.setItem('cv-user-data', JSON.stringify(next));
		location.reload();
	});
	await waitLayoutReady(page);
	await installLayoutCounter(page);
	trace.push(await readSnapshot(page, 'move-work-down'));

	// Reorder back to original
	await page.evaluate(() => {
		const cv = window.__CV_DATA__;
		if (!cv || !Array.isArray(cv.work) || cv.work.length < 2) { return; }
		const next = JSON.parse(JSON.stringify(cv));
		const tmp = next.work[0];
		next.work[0] = next.work[1];
		next.work[1] = tmp;
		localStorage.setItem('cv-user-data', JSON.stringify(next));
		location.reload();
	});
	await waitLayoutReady(page);
	await installLayoutCounter(page);
	trace.push(await readSnapshot(page, 'move-work-up'));

	// Edit summary text (append and remove)
	await page.evaluate(() => {
		const cv = window.__CV_DATA__;
		if (!cv || !cv.basics) { return; }
		const next = JSON.parse(JSON.stringify(cv));
		next.basics.summary = `${next.basics.summary ?? ''} Additional sentence for audit.`;
		localStorage.setItem('cv-user-data', JSON.stringify(next));
		location.reload();
	});
	await waitLayoutReady(page);
	await installLayoutCounter(page);
	trace.push(await readSnapshot(page, 'summary-lengthen'));

	await page.evaluate(() => {
		const cv = window.__CV_DATA__;
		if (!cv || !cv.basics) { return; }
		const next = JSON.parse(JSON.stringify(cv));
		next.basics.summary = String(next.basics.summary ?? '')
			.replace(' Additional sentence for audit.', '');
		localStorage.setItem('cv-user-data', JSON.stringify(next));
		location.reload();
	});
	await waitLayoutReady(page);
	await installLayoutCounter(page);
	trace.push(await readSnapshot(page, 'summary-restore'));

	await browser.close();
	server.close();

	const report = {
		generatedAt: new Date().toISOString(),
		quickHashCheck: hashString(JSON.stringify(trace)),
		trace,
	};
	if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
	writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.log('Wrote', reportPath);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

