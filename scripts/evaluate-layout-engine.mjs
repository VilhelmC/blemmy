/**
 * evaluate-layout-engine.mjs
 *
 * Programmatic layout evaluation harness for the CV engine.
 *
 * - Builds and serves /dist
 * - Runs placeholder-content scenarios in parallel
 * - Captures engine outcome (1-page vs 2-page) and whitespace tails (mm)
 * - Writes a JSON report to docs/reports/layout-eval-report.json
 */

import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { cpus } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const docsDir = join(root, 'docs', 'reports');
const reportPath = join(docsDir, 'layout-eval-report.json');
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

const PREFS = {
	maxDensity: 3,
	affinityWeight: 1.2,
	pagePreference: 'auto',
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
		server.listen(port, '127.0.0.1', () => resolvePromise(server));
	});
}

function deepClone(v) {
	return JSON.parse(JSON.stringify(v));
}

function repeatPhrase(seed, words) {
	const source = [
		'design',
		'analysis',
		'delivery',
		'coordination',
		'automation',
		'workflow',
		'optimization',
		'sustainability',
		'documentation',
		'leadership',
	];
	const out = [];
	for (let i = 0; i < words; i++) out.push(source[(seed + i) % source.length]);
	return out.join(' ');
}

function buildScenarioData(base, config) {
	const data = deepClone(base);
	const workCount = Math.max(2, config.workCount);
	const bulletsPerWork = Math.max(2, config.bulletsPerWork);
	const bulletWords = Math.max(8, config.bulletWords);
	const summaryWords = Math.max(8, config.summaryWords);
	const languageCount = Math.max(2, config.languageCount);
	const skillsPerBucket = Math.max(3, config.skillsPerBucket);

	data.work = [];
	for (let i = 0; i < workCount; i++) {
		const src = base.work[i % base.work.length];
		const highlights = [];
		for (let b = 0; b < bulletsPerWork; b++) {
			highlights.push(repeatPhrase(i * 17 + b * 3, bulletWords));
		}
		data.work.push({
			...src,
			company: `${src.company} ${i + 1}`,
			summary: repeatPhrase(i * 13, summaryWords),
			highlights,
		});
	}

	data.languages = [];
	for (let i = 0; i < languageCount; i++) {
		const src = base.languages[i % base.languages.length];
		data.languages.push({
			...src,
			language: `${src.language} ${i + 1}`,
		});
	}

	const buckets = Object.keys(base.skills);
	for (let bi = 0; bi < buckets.length; bi++) {
		const k = buckets[bi];
		data.skills[k] = [];
		for (let i = 0; i < skillsPerBucket; i++) {
			data.skills[k].push(`${k}-${i + 1}`);
		}
	}

	data.visibility = {
		...(data.visibility ?? {}),
		hiddenSections: [],
		hiddenWork: [],
		hiddenEducation: [],
	};

	return data;
}

function scenarioConfigs() {
	return [
		{ id: 'base', workCount: 6, bulletsPerWork: 4, bulletWords: 10, summaryWords: 16, languageCount: 4, skillsPerBucket: 6 },
		{ id: 'compact', workCount: 5, bulletsPerWork: 3, bulletWords: 9, summaryWords: 12, languageCount: 3, skillsPerBucket: 5 },
		{ id: 'heavy-bullets', workCount: 7, bulletsPerWork: 6, bulletWords: 13, summaryWords: 18, languageCount: 4, skillsPerBucket: 7 },
		{ id: 'heavy-skills', workCount: 6, bulletsPerWork: 4, bulletWords: 10, summaryWords: 14, languageCount: 5, skillsPerBucket: 10 },
		{ id: 'long-summary', workCount: 6, bulletsPerWork: 4, bulletWords: 10, summaryWords: 30, languageCount: 4, skillsPerBucket: 6 },
		{ id: 'minimal', workCount: 4, bulletsPerWork: 2, bulletWords: 8, summaryWords: 9, languageCount: 2, skillsPerBucket: 4 },
	];
}

async function evaluateScenario(browser, baseUrl, scenario) {
	const page = await browser.newPage();
	await page.setViewport({ width: 1440, height: 2100, deviceScaleFactor: 1 });
	const data = buildScenarioData(baseData, scenario);
	await page.evaluateOnNewDocument((payload, prefs) => {
		localStorage.setItem('cv-user-data', JSON.stringify(payload));
		localStorage.setItem('cv-layout-prefs', JSON.stringify(prefs));
		localStorage.removeItem('cv-edit-draft');
	}, data, PREFS);
	await page.goto(`${baseUrl}?cv-pdf=1`, { waitUntil: 'networkidle0', timeout: 30000 });
	await page.waitForFunction(
		() => document.querySelector('#cv-card')?.getAttribute('data-cv-layout-ready') === 'true',
		{ timeout: 30000 },
	);

	const metrics = await page.evaluate(() => {
		const MM_TO_PX = 96 / 25.4;
		function slackPx(col) {
			if (!col) return 0;
			const colRect = col.getBoundingClientRect();
			let maxBottom = colRect.top;
			const kids = Array.from(col.children);
			for (let i = 0; i < kids.length; i++) {
				const el = kids[i];
				if (!(el instanceof HTMLElement)) continue;
				if (el.classList.contains('cv-sidebar-tail-spacer')) continue;
				const st = getComputedStyle(el);
				if (st.display === 'none' || st.visibility === 'hidden') continue;
				const r = el.getBoundingClientRect();
				if (r.bottom > maxBottom) maxBottom = r.bottom;
			}
			return Math.max(0, colRect.bottom - maxBottom);
		}

		const card = document.getElementById('cv-card');
		const cols = [
			document.getElementById('cv-sidebar-1'),
			document.getElementById('cv-main-1'),
			document.getElementById('cv-sidebar-2'),
			document.getElementById('cv-main-2'),
		];
		const slacksPx = cols.map((c) => (c instanceof HTMLElement ? slackPx(c) : 0));
		const slacksMm = slacksPx.map((v) => Number((v / MM_TO_PX).toFixed(1)));
		return {
			disposition: card?.dataset.cvDisposition ?? 'unknown',
			pages: Number(card?.dataset.cvPages ?? 0),
			sidebarMm: Number(card?.dataset.cvSidebarMm ?? 0),
			alignApplied: card?.dataset.cvAlignApplied ?? '',
			layoutMs: Number(card?.dataset.cvLayoutMs ?? 0),
			winnerId: card?.dataset.cvWinnerId ?? '',
			layoutError: card?.dataset.cvLayoutError ?? '',
			candidates: {
				total: Number(card?.dataset.cvCandidatesTotal ?? 0),
				single: Number(card?.dataset.cvCandidatesSingle ?? 0),
				two: Number(card?.dataset.cvCandidatesTwo ?? 0),
			},
			scored: {
				total: Number(card?.dataset.cvScoredTotal ?? 0),
				single: Number(card?.dataset.cvScoredSingle ?? 0),
				two: Number(card?.dataset.cvScoredTwo ?? 0),
			},
			slackMm: {
				sidebar1: slacksMm[0],
				main1: slacksMm[1],
				sidebar2: slacksMm[2],
				main2: slacksMm[3],
			},
			totalSlackMm: Number(slacksMm.reduce((a, b) => a + b, 0).toFixed(1)),
			maxSlackMm: Number(Math.max(...slacksMm).toFixed(1)),
		};
	});
	await page.close();
	return { id: scenario.id, ...metrics };
}

async function runWithConcurrency(items, workerCount, fn) {
	const out = [];
	let idx = 0;
	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			const i = idx++;
			if (i >= items.length) break;
			out[i] = await fn(items[i]);
		}
	});
	await Promise.all(workers);
	return out;
}

async function main() {
	ensureDist();
	const port = 4323;
	const server = await startStaticServer(port);
	const baseUrl = `http://127.0.0.1:${port}/`;
	const puppeteer = await import('puppeteer');
	const browser = await puppeteer.default.launch({ headless: true });
	const scenarios = scenarioConfigs();
	const workers = Math.max(1, cpus().length);
	const results = await runWithConcurrency(
		scenarios,
		workers,
		(s) => evaluateScenario(browser, baseUrl, s),
	);
	await browser.close();
	server.close();

	const report = {
		generatedAt: new Date().toISOString(),
		workers,
		prefs: PREFS,
		results,
		summary: {
			singlePageCount: results.filter((r) => r.pages === 1).length,
			twoPageCount: results.filter((r) => r.pages === 2).length,
			worstMaxSlackMm: Number(Math.max(...results.map((r) => r.maxSlackMm)).toFixed(1)),
			avgTotalSlackMm: Number(
				(results.reduce((s, r) => s + r.totalSlackMm, 0) / results.length).toFixed(1),
			),
		},
	};

	if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
	writeFileSync(reportPath, JSON.stringify(report, null, 2));

	console.table(
		results.map((r) => ({
			id: r.id,
			pages: r.pages,
			cand: r.candidates.total,
			scored: r.scored.total,
			err: r.layoutError || '-',
			sidebar: r.sidebarMm,
			maxSlackMm: r.maxSlackMm,
			totalSlackMm: r.totalSlackMm,
		})),
	);
	console.log('Wrote', reportPath);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

