/**
 * build-pdf.mjs
 *
 * Generic HTML → PDF export for all Blemmy document types.
 * Uses puppeteer to open the built app, wait for layout to settle, export.
 *
 * Usage:
 *   node scripts/build-pdf.mjs                    # CV, A4
 *   node scripts/build-pdf.mjs --doc-type letter  # Letter, A4
 *   node scripts/build-pdf.mjs --doc-type cv --out ./my.pdf
 *
 * Page size is read from the DocumentTypeSpec (layout.pageSize).
 * Currently all types use A4; the field is there for future A3 / Letter.
 *
 * The app is navigated to /?blemmy-pdf=1&doc-type={type}
 * and waits for #{domPrefix}-card[data-blemmy-layout-ready="true"].
 * (The legacy /?cv-pdf=1 route still works for backward compatibility.)
 */

import { createServer }                                    from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join, dirname, resolve }                          from 'path';
import { fileURLToPath }                                   from 'url';
import { spawnSync }                                       from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = join(__dirname, '..');
const distDir   = join(root, 'dist');
const publicDir = join(root, 'public');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const docType  = args[args.indexOf('--doc-type') + 1] ?? 'cv';
const outArg   = args[args.indexOf('--out') + 1] ?? null;

// ─── Document type → spec (read from JSON directly in Node) ──────────────────

const DOCTYPE_DIR  = join(root, 'src', 'data', 'doctypes');
const DOCTYPE_FILE = join(DOCTYPE_DIR, `${docType}.doctype.json`);

if (!existsSync(DOCTYPE_FILE)) {
	console.error(`Unknown doc-type: "${docType}". No file at ${DOCTYPE_FILE}`);
	process.exit(1);
}

const spec      = JSON.parse(readFileSync(DOCTYPE_FILE, 'utf8'));
const pageSize  = spec.medium?.pageSize ?? spec.layout?.pageSize ?? 'A4';
const domPrefix = spec.domPrefix ?? docType;

// Page dimensions in mm (A4 only for now — extend as needed)
const PAGE_DIMS = {
	A4:     { widthMm: 210, heightMm: 297 },
	Letter: { widthMm: 215.9, heightMm: 279.4 },
	A3:     { widthMm: 297, heightMm: 420 },
};

const dims = PAGE_DIMS[pageSize] ?? PAGE_DIMS.A4;
const pageWidthPx  = Math.round((dims.widthMm  / 25.4) * 96);
const pageHeightPx = Math.round((dims.heightMm / 25.4) * 96);

// ─── Output path ──────────────────────────────────────────────────────────────

const outFilename = outArg ?? join(distDir, `${docType}.pdf`);

// ─── MIME types ───────────────────────────────────────────────────────────────

const MIME = {
	'.html':  'text/html',
	'.css':   'text/css',
	'.js':    'application/javascript',
	'.json':  'application/json',
	'.ico':   'image/x-icon',
	'.png':   'image/png',
	'.jpg':   'image/jpeg',
	'.jpeg':  'image/jpeg',
	'.svg':   'image/svg+xml',
	'.woff2': 'font/woff2',
	'.woff':  'font/woff',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDist() {
	if (!existsSync(distDir)) {
		console.log('Running vite build...');
		const r = spawnSync('npm', ['run', 'build'], {
			cwd: root, stdio: 'inherit', shell: true,
		});
		if (r.status !== 0) { throw new Error('vite build failed'); }
	}
	if (!existsSync(join(distDir, 'index.html'))) {
		throw new Error('dist/index.html not found; run "npm run build" first');
	}
}

function startStaticServer(port) {
	const distResolved = resolve(distDir);
	return new Promise((resolvePromise) => {
		const server = createServer((req, res) => {
			let pathname = req.url?.split('?')[0] || '/';
			if (pathname === '/') { pathname = '/index.html'; }
			const relative = pathname.replace(/^\//, '') || 'index.html';
			const filePath = join(distResolved, relative);
			const normalized = resolve(filePath);
			if (!normalized.startsWith(distResolved)) {
				res.statusCode = 403; res.end(); return;
			}
			let servePath = filePath;
			if (existsSync(filePath) && statSync(filePath).isDirectory()) {
				servePath = join(filePath, 'index.html');
			}
			if (!existsSync(servePath) || !statSync(servePath).isFile()) {
				res.statusCode = 404; res.end(); return;
			}
			const ext = servePath.slice(servePath.lastIndexOf('.'));
			res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
			res.end(readFileSync(servePath));
		});
		server.listen(port, '127.0.0.1', () => resolvePromise(server));
	});
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	ensureDist();

	console.log(`\nGenerating PDF for doc-type: ${docType} (${pageSize})`);
	console.log(`Output: ${outFilename}\n`);

	const port    = 4322;
	const server  = await startStaticServer(port);
	const baseUrl = `http://127.0.0.1:${port}`;

	const puppeteer = await import('puppeteer');
	const browser   = await puppeteer.default.launch({ headless: true });
	const page      = await browser.newPage();

	await page.setViewport({
		width:             pageWidthPx,
		height:            pageHeightPx,
		deviceScaleFactor: 2,
	});

	await page.emulateMediaType('print');

	// Navigate to the correct document type
	const url = `${baseUrl}/?blemmy-pdf=1&doc-type=${encodeURIComponent(docType)}`;
	await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

	// Wait for the layout engine to signal readiness
	// The card element is #{domPrefix}-card (e.g. #blemmy-card)
	const cardSelector = `#${domPrefix}-card`;
	try {
		await page.waitForFunction(
			(selector) =>
				document.querySelector(selector)?.getAttribute('data-blemmy-layout-ready') === 'true',
			{ timeout: 25000 },
			cardSelector,
		);
	} catch {
		// Single-column docs may not run the full engine — just wait for fonts
		console.warn(`  Layout ready signal not received for ${cardSelector}; proceeding after font load`);
	}

	// Ensure fonts are loaded and give a brief stabilisation pause
	await page.evaluate(() => document.fonts.ready);
	await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));

	// Generate PDF
	const outDir = dirname(resolve(outFilename));
	if (!existsSync(outDir)) { mkdirSync(outDir, { recursive: true }); }

	await page.pdf({
		path:            outFilename,
		format:          pageSize,
		printBackground: true,
		margin:          { top: 0, right: 0, bottom: 0, left: 0 },
		preferCSSPageSize: true,
	});

	await browser.close();
	server.close();

	// Copy to public/ for convenience
	if (!existsSync(publicDir)) { mkdirSync(publicDir, { recursive: true }); }
	const publicPath = join(publicDir, `${docType}.pdf`);
	writeFileSync(publicPath, readFileSync(outFilename));

	console.log(`Wrote ${outFilename}`);
	console.log(`Wrote ${publicPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
