/**
 * Coordinate helpers for the *visual viewport* (mainly mobile **pinch-zoom**).
 *
 * Not the same as desktop “browser zoom” (Ctrl+-): on Chromium desktop,
 * `visualViewport.scale` stays `1` for full-page zoom. Pinch-zoom is separate.
 * https://github.com/WICG/visual-viewport/issues/41
 *
 * Prefer the **pure** helpers (`normalizePinchScale`, `clientDeltaToLayoutShift`,
 * `dockPeekSlideLayoutPx`, …) in tests; the no-arg wrappers read
 * `window.visualViewport`.
 *
 * MDN: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
 */

export const MIN_PINCH_SCALE = 0.01;

/**
 * σ from `visualViewport.scale`, clamped. Missing / invalid → `1`.
 */
export function normalizePinchScale(scale: number | null | undefined): number {
	if (scale == null || !Number.isFinite(scale)) {
		return 1;
	}
	return Math.max(scale, MIN_PINCH_SCALE);
}

/** `1/σ` for `transform: scale(…)` on UI that should resist pinch-zoom. */
export function uiZoomCompFromScale(scale: number): number {
	return 1 / normalizePinchScale(scale);
}

/**
 * Apparent client-reference shift from `layoutShiftPx` on fixed UI
 * (`≈ layoutShiftPx × σ`).
 */
export function layoutShiftToClientDelta(
	layoutShiftPx: number,
	scale: number,
): number {
	return layoutShiftPx * normalizePinchScale(scale);
}

/**
 * `translateX` layout px to obtain `clientCssDelta` apparent motion
 * (`≈ clientCssDelta / σ`).
 */
export function clientDeltaToLayoutShift(
	clientCssDelta: number,
	scale: number,
): number {
	return clientCssDelta / normalizePinchScale(scale);
}

/**
 * Dock peek: `translateX` distance (layout px). `paintedLayoutWidth` should be
 * `getBoundingClientRect().width` of the zoom shell **after** its
 * `scale(1/σ)` (~`offsetWidth/σ`). Clearance is in client-reference px.
 */
export function dockPeekSlideLayoutPx(p: {
	paintedLayoutWidth: number;
	clearanceClientRefPx: number;
	scale: number;
}): number {
	return (
		p.paintedLayoutWidth +
		clientDeltaToLayoutShift(p.clearanceClientRefPx, p.scale)
	);
}

// --- Window-bound API (orchestration) ------------------------------------

/** Pinch-zoom factor σ (`visualViewport.scale`). */
export function pinchZoomScale(): number {
	return normalizePinchScale(window.visualViewport?.scale);
}

/** `1/σ`: pass to `transform: scale(...)` so fixed UI stays constant size. */
export function uiZoomCompensation(): number {
	return uiZoomCompFromScale(pinchZoomScale());
}

/**
 * Apparent on-screen horizontal shift (client-reference CSS px) produced by
 * `transform: translateX(layoutShiftPx)` on fixed-position UI.
 */
export function layoutTransformShiftToClientCssDelta(
	layoutShiftPx: number,
): number {
	return layoutShiftToClientDelta(layoutShiftPx, pinchZoomScale());
}

/**
 * `translateX` / `translate` distance (layout px) that yields
 * `clientCssDelta` apparent motion on screen (client-reference CSS px).
 */
export function clientCssDeltaToLayoutTransformShift(
	clientCssDelta: number,
): number {
	return clientDeltaToLayoutShift(clientCssDelta, pinchZoomScale());
}

/**
 * Border-box width **before** the element’s own transforms — “effective full”
 * layout width (e.g. dock glass before `scale(1/σ)`).
 */
export function elementLayoutBorderWidth(el: HTMLElement): number {
	return el.offsetWidth;
}
