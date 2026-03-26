// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
	applyReviewWidthClamp,
	clearReviewWidthClamp,
} from '@lib/review-layout-clamp';

function mockRect(el: HTMLElement, width: number): void {
	el.getBoundingClientRect = (() => ({
		width,
		height: 0,
		top: 0,
		left: 0,
		right: width,
		bottom: 0,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	})) as () => DOMRect;
}

function setupDom(hidden = false): void {
	document.body.innerHTML = `
		<div id="blemmy-review-panel" ${hidden ? 'hidden' : ''}></div>
		<div id="cv-shell">
			<div id="cv-card">
				<div id="cv-page-1" class="cv-page">
					<div class="cv-grid"></div>
				</div>
				<div id="cv-page-2" class="cv-page">
					<div class="cv-grid"></div>
				</div>
			</div>
		</div>
	`;
	const shell = document.getElementById('cv-shell') as HTMLElement;
	const card = document.getElementById('cv-card') as HTMLElement;
	mockRect(shell, 720);
	mockRect(card, 740);
}

describe('review layout clamp', () => {
	it('applies clamp when review panel is open on desktop', () => {
		setupDom(false);
		const report = applyReviewWidthClamp(document, true);
		const card = document.getElementById('cv-card') as HTMLElement;
		expect(report.applied).toBe(true);
		expect(card.style.maxWidth).toBe('720px');
		expect(card.style.minWidth).toBe('0px');
		expect(card.style.width).toBe('100%');
	});

	it('clears clamp when review panel is hidden', () => {
		setupDom(true);
		const report = applyReviewWidthClamp(document, true);
		const card = document.getElementById('cv-card') as HTMLElement;
		expect(report.applied).toBe(false);
		expect(card.style.maxWidth).toBe('');
	});

	it('clears clamp explicitly', () => {
		setupDom(false);
		applyReviewWidthClamp(document, true);
		clearReviewWidthClamp(document);
		const card = document.getElementById('cv-card') as HTMLElement;
		expect(card.style.maxWidth).toBe('');
		expect(card.style.minWidth).toBe('');
		expect(card.style.width).toBe('');
	});
});
