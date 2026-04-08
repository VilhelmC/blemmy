/**
 * build-cv-pdf.mjs
 * HTML → PDF: Puppeteer opens /?cv-pdf=1, print media + data-blemmy-layout-ready.
 * Print preview uses screen + blemmy-print-surface.css; PDF uses @media print only.
 * Masthead/portrait parity: src/styles/blemmy-print-parity.css (both contexts).
 */

import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const publicDir = join(root, 'public');

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
		console.log('Running vite build...');
		const r = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
		if (r.status !== 0) throw new Error('vite build failed');
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
			const contentType = MIME[ext] || 'application/octet-stream';
			res.setHeader('Content-Type', contentType);
			res.end(readFileSync(servePath));
		});
		server.listen(port, '127.0.0.1', () => resolvePromise(server));
	});
}

async function main() {
	ensureDist();

	const port = 4322;
	const server = await startStaticServer(port);
	const baseUrl = `http://127.0.0.1:${port}`;

	const puppeteer = await import('puppeteer');
	const browser = await puppeteer.default.launch({ headless: true });
	const page = await browser.newPage();

	// A4 viewport so layout matches PDF (96dpi: 210mm ≈ 794px, 297mm ≈ 1122px)
	const a4WidthPx = Math.round((210 / 25.4) * 96);
	const a4HeightPx = Math.round((297 / 25.4) * 96);
	await page.setViewport({
		width: a4WidthPx,
		height: a4HeightPx,
		deviceScaleFactor: 2,
	});

	await page.emulateMediaType('print');
	await page.goto(`${baseUrl}/?cv-pdf=1`, {
		waitUntil: 'networkidle0',
		timeout: 20000,
	});

	await page.waitForFunction(
		() =>
			document.querySelector('#blemmy-card')?.getAttribute('data-blemmy-layout-ready') ===
			'true',
		{ timeout: 25000 }
	);

	await page.evaluate(() => document.fonts.ready);
	await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));

	const pdfPath = join(distDir, 'cv.pdf');
	await page.pdf({
		path: pdfPath,
		format: 'A4',
		printBackground: true,
		margin: { top: 0, right: 0, bottom: 0, left: 0 },
		preferCSSPageSize: true,
	});

	await browser.close();
	server.close();

	if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });
	const publicPdf = join(publicDir, 'cv.pdf');
	writeFileSync(publicPdf, readFileSync(pdfPath));
	console.log('Wrote', pdfPath);
	console.log('Wrote', publicPdf);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
