/**
 * test-layout-recalc.mjs
 *
 * Automated regression check:
 * - Open CV in print mode
 * - Repeatedly change layout preferences
 * - Wait for each layout pass
 * - Assert candidate generation never drops to zero
 * - Write detailed diagnostics JSON report
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
const reportPath = join(docsDir, 'layout-recalc-diagnostics.json');

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

async function readCardDiag(page) {
	return page.evaluate(() => {
		const c = document.getElementById('cv-card');
		if (!c) return null;
		const d = c.dataset;
		return {
			layoutMs: Number(d.cvLayoutMs ?? 0),
			disposition: d.cvDisposition ?? '',
			pages: Number(d.cvPages ?? 0),
			winnerId: d.cvWinnerId ?? '',
			layoutError: d.cvLayoutError ?? '',
			candidates: {
				total: Number(d.cvCandidatesTotal ?? 0),
				tried: Number(d.cvCandidatesTried ?? 0),
				rejected: Number(d.cvCandidatesRejected ?? 0),
				single: Number(d.cvCandidatesSingle ?? 0),
				two: Number(d.cvCandidatesTwo ?? 0),
				rejectTop: d.cvCandidatesRejectTop ?? '',
			},
			scored: {
				total: Number(d.cvScoredTotal ?? 0),
				single: Number(d.cvScoredSingle ?? 0),
				two: Number(d.cvScoredTwo ?? 0),
			},
			workItems: {
				count: Number(d.cvWorkItemsCount ?? 0),
				source: d.cvWorkItemsSource ?? '',
			},
		};
	});
}

async function waitNextLayout(page, prevLayoutMs) {
	await page.waitForFunction(
		(previous) => {
			const c = document.getElementById('cv-card');
			if (!c) return false;
			const ready = c.getAttribute('data-cv-layout-ready') === 'true';
			const ms = Number(c.dataset.cvLayoutMs ?? 0);
			return ready && ms > previous;
		},
		{ timeout: 30000 },
		prevLayoutMs,
	);
}

async function installLayoutCounter(page) {
	await page.evaluate(() => {
		const w = window;
		if (typeof w.__layoutAppliedCount !== 'number') {
			w.__layoutAppliedCount = 0;
			window.addEventListener('cv-layout-applied', () => {
				w.__layoutAppliedCount += 1;
			});
		}
	});
}

async function readLayoutCounter(page) {
	return page.evaluate(() => window.__layoutAppliedCount ?? 0);
}

async function main() {
	ensureDist();
	const { server, port } = await startStaticServer(0);
	const baseUrl = `http://127.0.0.1:${port}/?cv-pdf=1`;
	const puppeteer = await import('puppeteer');
	const browser = await puppeteer.default.launch({ headless: true });
	const page = await browser.newPage();
	await page.setViewport({ width: 1500, height: 2100, deviceScaleFactor: 1 });
	await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
	await page.waitForFunction(
		() => document.querySelector('#cv-card')?.getAttribute('data-cv-layout-ready') === 'true',
		{ timeout: 30000 },
	);
	await installLayoutCounter(page);

	const prefSequence = [
		{ maxDensity: 3, affinityWeight: 1.2, pagePreference: 'auto' },
		{ maxDensity: 1, affinityWeight: 1.2, pagePreference: 'auto' },
		{ maxDensity: 3, affinityWeight: 2.5, pagePreference: 'auto' },
		{ maxDensity: 2, affinityWeight: 0.8, pagePreference: 'prefer-1' },
		{ maxDensity: 3, affinityWeight: 1.2, pagePreference: 'prefer-2' },
		{ maxDensity: 0, affinityWeight: 1.8, pagePreference: 'auto' },
		{ maxDensity: 3, affinityWeight: 1.2, pagePreference: 'auto' },
	];

	const runs = [];
	let prior = await readCardDiag(page);
	runs.push({ step: 'initial', prefs: null, diag: prior });

	for (let i = 0; i < prefSequence.length; i++) {
		const prefs = prefSequence[i];
		const prevMs = prior?.layoutMs ?? 0;
		const prevCount = await readLayoutCounter(page);
		await page.evaluate((p) => {
			localStorage.setItem('cv-layout-prefs', JSON.stringify(p));
			window.dispatchEvent(new CustomEvent('cv-prefs-changed', { detail: { prefs: p } }));
			window.dispatchEvent(new Event('resize'));
		}, prefs);
		let timeout = false;
		try {
			await page.waitForFunction(
				(previous) => (window.__layoutAppliedCount ?? 0) > previous,
				{ timeout: 12000 },
				prevCount,
			);
			await waitNextLayout(page, prevMs);
		} catch {
			timeout = true;
		}
		prior = await readCardDiag(page);
		runs.push({
			step: `change-${i + 1}`,
			prefs,
			timeout,
			layoutAppliedDelta: (await readLayoutCounter(page)) - prevCount,
			diag: prior,
		});
	}

	await browser.close();
	server.close();

	const zeroCandidateRuns = runs.filter((r) => (r.diag?.candidates?.total ?? 0) === 0);
	const report = {
		generatedAt: new Date().toISOString(),
		zeroCandidateRuns: zeroCandidateRuns.map((r) => r.step),
		runs,
	};
	if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
	writeFileSync(reportPath, JSON.stringify(report, null, 2));

	console.table(
		runs.map((r) => ({
			step: r.step,
			timeout: r.timeout ? 'yes' : 'no',
			applied: r.layoutAppliedDelta ?? 0,
			pages: r.diag?.pages ?? 0,
			cand: r.diag?.candidates?.total ?? 0,
			tried: r.diag?.candidates?.tried ?? 0,
			rej: r.diag?.candidates?.rejected ?? 0,
			top: r.diag?.candidates?.rejectTop ?? '-',
			scored: r.diag?.scored?.total ?? 0,
			work: `${r.diag?.workItems?.count ?? 0} (${r.diag?.workItems?.source ?? '-'})`,
			err: r.diag?.layoutError ?? '-',
			ms: r.diag?.layoutMs ?? 0,
		})),
	);
	console.log('Wrote', reportPath);

	if (zeroCandidateRuns.length > 0) {
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

