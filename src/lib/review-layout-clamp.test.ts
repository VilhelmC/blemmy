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
		<div id="blemmy-doc-shell">
			<div id="blemmy-card">
				<div id="blemmy-page-1" class="blemmy-page">
					<div class="blemmy-grid"></div>
				</div>
				<div id="blemmy-page-2" class="blemmy-page">
					<div class="blemmy-grid"></div>
				</div>
			</div>
		</div>
	`;
	const shell = document.getElementById('blemmy-doc-shell') as HTMLElement;
	const card = document.getElementById('blemmy-card') as HTMLElement;
	mockRect(shell, 720);
	mockRect(card, 740);
}

describe('review layout clamp', () => {
	it('applies clamp when review panel is open on desktop', () => {
		setupDom(false);
		const report = applyReviewWidthClamp(document, true);
		const card = document.getElementById('blemmy-card') as HTMLElement;
		expect(report.applied).toBe(true);
		expect(card.style.maxWidth).toBe('720px');
		expect(card.style.minWidth).toBe('0px');
		expect(card.style.width).toBe('100%');
	});

	it('clears clamp when review panel is hidden', () => {
		setupDom(true);
		const report = applyReviewWidthClamp(document, true);
		const card = document.getElementById('blemmy-card') as HTMLElement;
		expect(report.applied).toBe(false);
		expect(card.style.maxWidth).toBe('');
	});

	it('applies clamp when assistant/edit layout is active without review panel', () => {
		document.body.innerHTML = `
			<div id="blemmy-doc-shell">
				<div id="blemmy-card">
					<div id="blemmy-page-1" class="blemmy-page">
						<div class="blemmy-grid"></div>
					</div>
				</div>
			</div>
		`;
		document.documentElement.classList.add('blemmy-panel-open', 'blemmy-panel-desktop');
		const shell = document.getElementById('blemmy-doc-shell') as HTMLElement;
		const card = document.getElementById('blemmy-card') as HTMLElement;
		mockRect(shell, 600);
		mockRect(card, 800);
		const report = applyReviewWidthClamp(document, true);
		expect(report.applied).toBe(true);
		expect(card.style.maxWidth).toBe('600px');
		document.documentElement.classList.remove('blemmy-panel-open', 'blemmy-panel-desktop');
	});

	it('clears clamp explicitly', () => {
		setupDom(false);
		applyReviewWidthClamp(document, true);
		clearReviewWidthClamp(document);
		const card = document.getElementById('blemmy-card') as HTMLElement;
		expect(card.style.maxWidth).toBe('');
		expect(card.style.minWidth).toBe('');
		expect(card.style.width).toBe('');
	});
});
