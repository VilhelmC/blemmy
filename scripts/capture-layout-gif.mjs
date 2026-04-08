import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';

const { GIFEncoder, applyPalette, quantize } = gifenc;

const CAPTURE_URL = process.env.CAPTURE_URL ?? 'http://127.0.0.1:5923/';
const OUT_DIR = resolve(process.cwd(), 'docs', 'assets');
const VIDEO_PATH = resolve(OUT_DIR, 'layout-search.webm');
const GIF_PATH = resolve(OUT_DIR, 'layout-search.gif');
const VIEWPORT = { width: 1365, height: 900 };

const SETTLE_QUIET_MS = Number(process.env.CAPTURE_QUIET_MS ?? 350);
const SETTLE_TIMEOUT_MS = Number(process.env.CAPTURE_TIMEOUT_MS ?? 20_000);
const GIF_FPS = Number(process.env.CAPTURE_GIF_FPS ?? 12);
const GIF_WIDTH = Number(process.env.CAPTURE_GIF_WIDTH ?? 1200);
const AUTO_START_DEV = process.env.CAPTURE_AUTO_DEV !== '0';

if (!existsSync(OUT_DIR)) {
	mkdirSync(OUT_DIR, { recursive: true });
}

function hasFfmpeg() {
	const proc = spawnSync('ffmpeg', ['-version'], {
		stdio: 'ignore',
		shell: true,
	});
	return proc.status === 0;
}

async function wait(ms) {
	return new Promise((resolveWait) => { setTimeout(resolveWait, ms); });
}

async function canReach(url) {
	try {
		const res = await fetch(url, { method: 'GET' });
		return res.ok || res.status > 0;
	} catch {
		return false;
	}
}

function npmCommand() {
	return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function killProcessTree(pid) {
	if (!pid) {
		return;
	}
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
			stdio: 'ignore',
			shell: true,
		});
		return;
	}
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		/* noop */
	}
}

async function ensureDevServer(url) {
	if (await canReach(url)) {
		return { child: null, started: false };
	}
	if (!AUTO_START_DEV) {
		throw new Error(`Cannot reach ${url}. Start dev server or enable CAPTURE_AUTO_DEV.`);
	}
	const child = spawn(npmCommand(), ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5923'], {
		cwd: process.cwd(),
		shell: false,
		stdio: 'pipe',
	});
	child.stdout?.on('data', (chunk) => {
		const text = String(chunk);
		if (text.trim()) {
			console.log(`[dev] ${text.trim()}`);
		}
	});
	child.stderr?.on('data', (chunk) => {
		const text = String(chunk);
		if (text.trim()) {
			console.warn(`[dev] ${text.trim()}`);
		}
	});
	const startedAt = Date.now();
	while ((Date.now() - startedAt) < 60_000) {
		if (await canReach(url)) {
			return { child, started: true };
		}
		if (child.exitCode != null) {
			throw new Error(`Dev server exited early with code ${child.exitCode}`);
		}
		await wait(500);
	}
	killProcessTree(child.pid);
	throw new Error(`Timed out waiting for dev server at ${url}`);
}

async function waitForSplashHidden(page, timeoutMs = 15_000) {
	await page.waitForFunction(() => {
		const splash = document.getElementById('cv-boot-splash');
		if (!splash) {
			return true;
		}
		if (splash.hasAttribute('hidden')) {
			return true;
		}
		return window.getComputedStyle(splash).display === 'none';
	}, { timeout: timeoutMs });
}

async function waitForLayoutSettled(page, quietMs, timeoutMs) {
	const result = await page.evaluate(async ({ q, t }) => {
		const now = () => performance.now();
		const waitFor = (ms) => new Promise((r) => { setTimeout(r, ms); });
		const start = now();
		let lastLayout = now();
		const onLayout = () => { lastLayout = now(); };
		window.addEventListener('blemmy-layout-applied', onLayout);
		function isReady() {
			const shell = document.getElementById('blemmy-doc-shell');
			if (!(shell instanceof HTMLElement)) {
				return false;
			}
			const card = document.getElementById('blemmy-card');
			return card?.getAttribute('data-blemmy-layout-ready') === 'true';
		}
		try {
			while ((now() - start) < t) {
				if (!isReady()) {
					await waitFor(25);
					continue;
				}
				if ((now() - lastLayout) >= q) {
					return {
						settled: true,
						elapsedMs: Math.round(now() - start),
						quietWindowMs: Math.round(now() - lastLayout),
					};
				}
				await waitFor(25);
			}
			return {
				settled: false,
				elapsedMs: Math.round(now() - start),
				quietWindowMs: Math.round(now() - lastLayout),
			};
		} finally {
			window.removeEventListener('blemmy-layout-applied', onLayout);
		}
	}, { q: quietMs, t: timeoutMs });
	return result;
}

async function warmAndMeasure(browser) {
	const context = await browser.newContext({ viewport: VIEWPORT });
	const page = await context.newPage();
	await page.goto(CAPTURE_URL, { waitUntil: 'domcontentloaded' });
	await waitForSplashHidden(page);
	await waitForLayoutSettled(page, SETTLE_QUIET_MS, SETTLE_TIMEOUT_MS);

	const reloadNodeStart = Date.now();
	await page.reload({ waitUntil: 'domcontentloaded' });
	await waitForSplashHidden(page);
	const splashOffsetMs = Date.now() - reloadNodeStart;
	const settle = await waitForLayoutSettled(page, SETTLE_QUIET_MS, SETTLE_TIMEOUT_MS);
	await context.close();

	return {
		splashOffsetMs,
		recordDurationMs: Math.max(1200, settle.elapsedMs + 300),
	};
}

async function recordPass(browser) {
	const context = await browser.newContext({
		viewport: VIEWPORT,
		recordVideo: {
			dir: OUT_DIR,
			size: VIEWPORT,
		},
	});
	const page = await context.newPage();
	await page.goto(CAPTURE_URL, { waitUntil: 'domcontentloaded' });
	await waitForSplashHidden(page);
	await waitForLayoutSettled(page, SETTLE_QUIET_MS, SETTLE_TIMEOUT_MS);

	const reloadNodeStart = Date.now();
	await page.reload({ waitUntil: 'domcontentloaded' });
	await waitForSplashHidden(page);
	const splashOffsetMs = Date.now() - reloadNodeStart;
	const settle = await waitForLayoutSettled(page, SETTLE_QUIET_MS, SETTLE_TIMEOUT_MS);

	const video = page.video();
	await context.close();
	const videoPath = await video.path();
	return {
		videoPath,
		splashOffsetMs,
		recordDurationMs: Math.max(1200, settle.elapsedMs + 300),
	};
}

async function captureGifDirect(browser, durationMs) {
	const context = await browser.newContext({ viewport: VIEWPORT });
	const page = await context.newPage();
	await page.goto(CAPTURE_URL, { waitUntil: 'domcontentloaded' });
	await waitForSplashHidden(page);
	await waitForLayoutSettled(page, SETTLE_QUIET_MS, SETTLE_TIMEOUT_MS);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await waitForSplashHidden(page);

	const frameMs = Math.max(60, Math.round(1000 / GIF_FPS));
	const frameCount = Math.max(1, Math.ceil(durationMs / frameMs));
	const gif = GIFEncoder();

	for (let i = 0; i < frameCount; i++) {
		const pngBytes = await page.screenshot({
			type: 'png',
			fullPage: false,
		});
		const decoded = PNG.sync.read(pngBytes);
		const rgba = decoded.data;
		const palette = quantize(rgba, 128);
		const indices = applyPalette(rgba, palette);
		gif.writeFrame(indices, decoded.width, decoded.height, {
			palette,
			delay: frameMs,
			repeat: i === 0 ? 0 : undefined,
		});
		await wait(frameMs);
	}

	gif.finish();
	writeFileSync(GIF_PATH, Buffer.from(gif.bytesView()));
	await context.close();
}

function toSec(ms) {
	return (ms / 1000).toFixed(3);
}

function runFfmpegVideoTrim(src, dst, startMs, durationMs) {
	const args = [
		'-y',
		'-ss', toSec(startMs),
		'-t', toSec(durationMs),
		'-i', src,
		'-an',
		'-c:v', 'libvpx-vp9',
		'-b:v', '0',
		'-crf', '30',
		dst,
	];
	const proc = spawnSync('ffmpeg', args, { stdio: 'inherit', shell: true });
	return proc.status === 0;
}

function runFfmpegGif(src, dst, startMs, durationMs) {
	const filter = [
		`fps=${GIF_FPS}`,
		`scale=${GIF_WIDTH}:-1:flags=lanczos`,
		'split[s0][s1]',
		'[s0]palettegen=max_colors=128[p]',
		'[s1][p]paletteuse=dither=bayer',
	].join(',');
	const args = [
		'-y',
		'-ss', toSec(startMs),
		'-t', toSec(durationMs),
		'-i', src,
		'-vf', filter,
		'-loop', '0',
		dst,
	];
	const proc = spawnSync('ffmpeg', args, { stdio: 'inherit', shell: true });
	return proc.status === 0;
}

async function main() {
	const dev = await ensureDevServer(CAPTURE_URL);
	const browser = await chromium.launch({ headless: true });
	try {
		console.log('[capture] warm + timing pass:', CAPTURE_URL);
		const timing = await warmAndMeasure(browser);
		console.log('[capture] measured start offset (after splash):', `${timing.splashOffsetMs}ms`);
		console.log('[capture] measured layout duration:', `${timing.recordDurationMs}ms`);

		console.log('[capture] recording pass...');
		const recording = await recordPass(browser);
		console.log('[capture] raw video:', recording.videoPath);

		if (!hasFfmpeg()) {
			console.log('[capture] ffmpeg not found; using Playwright screenshot fallback for GIF.');
			await captureGifDirect(browser, recording.recordDurationMs);
			console.log('[capture] gif written (fallback):', GIF_PATH);
			return;
		}
		const startMs = recording.splashOffsetMs;
		const durationMs = recording.recordDurationMs;
		const trimOk = runFfmpegVideoTrim(
			recording.videoPath,
			VIDEO_PATH,
			startMs,
			durationMs,
		);
		if (!trimOk) {
			throw new Error('ffmpeg failed to trim video');
		}
		console.log('[capture] trimmed video:', VIDEO_PATH);

		const gifOk = runFfmpegGif(
			recording.videoPath,
			GIF_PATH,
			startMs,
			durationMs,
		);
		if (!gifOk) {
			throw new Error('ffmpeg failed to create gif');
		}
		console.log('[capture] gif written:', GIF_PATH);
	} finally {
		await browser.close();
		if (dev.child && dev.started) {
			killProcessTree(dev.child.pid);
		}
	}
}

main().catch((err) => {
	console.error('[capture] failed:', err);
	process.exitCode = 1;
});
