import type { Page } from '@playwright/test';

export type PaperRect = {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
};

export type PaperOverflowViolation = {
	summary: string;
	overflowPx: { left: number; right: number; top: number; bottom: number };
};

export type PaperContainmentReport =
	| {
		ok: true;
		paper: PaperRect;
		violationCount: number;
		violations: PaperOverflowViolation[];
		truncated: boolean;
	}
	| { ok: false; reason: string };

type MeasureOpts = {
	epsilon?: number;
	maxViolationSamples?: number;
	/**
	 * `horizontal` — only left/right vs `#cv-shell` (default). Matches the
	 * “paper wider than column” regression; tall CVs may extend below the
	 * shell when height is viewport-bound.
	 * `both` — also top/bottom (stricter).
	 */
	axes?: 'horizontal' | 'both';
};

/**
 * Visible descendants of `#cv-shell` must not extend past the shell’s
 * left/right edges (viewport coords), within epsilon. Default is
 * horizontal-only; use `axes: 'both'` for full box checks.
 */
export async function measurePaperContainment(
	page: Page,
	opts: MeasureOpts = {},
): Promise<PaperContainmentReport> {
	const epsilon = opts.epsilon ?? 4;
	const maxViolationSamples = opts.maxViolationSamples ?? 40;
	const axes = opts.axes ?? 'horizontal';
	return page.evaluate(
		({ epsilon, maxViolationSamples, axes }) => {
			const shell = document.getElementById('cv-shell');
			if (!shell) {
				return { ok: false as const, reason: 'missing #cv-shell' };
			}
			const p = shell.getBoundingClientRect();
			const paper = {
				left: p.left,
				right: p.right,
				top: p.top,
				bottom: p.bottom,
				width: p.width,
				height: p.height,
			};
			const violations: PaperOverflowViolation[] = [];
			const els = shell.querySelectorAll('*');

			for (const el of els) {
				if (!(el instanceof HTMLElement)) {
					continue;
				}
				const cs = getComputedStyle(el);
				if (cs.display === 'none' || cs.visibility === 'hidden') {
					continue;
				}
				if (el.hasAttribute('hidden')) {
					continue;
				}
				const r = el.getBoundingClientRect();
				if (r.width <= 0.25 || r.height <= 0.25) {
					continue;
				}

				const oLeft = Math.max(0, p.left - r.left - epsilon);
				const oRight = Math.max(0, r.right - p.right - epsilon);
				const oTop = Math.max(0, p.top - r.top - epsilon);
				const oBottom = Math.max(0, r.bottom - p.bottom - epsilon);

				const overX = oLeft > 0 || oRight > 0;
				const overY = oTop > 0 || oBottom > 0;
				const bad =
					axes === 'both' ? overX || overY : overX;
				if (bad) {
					const id = el.id;
					const clsRaw = el.getAttribute('class') ?? '';
					const cls = clsRaw.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
					const summary = id
						? `#${id}`
						: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;

					violations.push({
						summary,
						overflowPx: {
							left: Math.round(oLeft * 10) / 10,
							right: Math.round(oRight * 10) / 10,
							top: Math.round(oTop * 10) / 10,
							bottom: Math.round(oBottom * 10) / 10,
						},
					});
				}
			}

			const violationCount = violations.length;
			const truncated = violations.length > maxViolationSamples;
			return {
				ok: true as const,
				paper,
				violationCount,
				violations: violations.slice(0, maxViolationSamples),
				truncated,
			};
		},
		{ epsilon, maxViolationSamples, axes },
	);
}

/** Waits for layout engine + short settle (same idea as mobile paper tests). */
export async function waitForCvLayoutReady(page: Page): Promise<void> {
	await page.waitForFunction(
		() =>
			document.getElementById('cv-card')?.getAttribute('data-cv-layout-ready') ===
			'true',
		{ timeout: 60_000 },
	);
	await page.waitForTimeout(250);
}
