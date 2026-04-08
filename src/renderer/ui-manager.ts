/**
 * Central UI manager for viewport + zoom derived UI vars.
 *
 * `--blemmy-ui-zoom-comp` is the single pinch-zoom factor for fixed UI: `1/σ`
 * from `visualViewport.scale`, written in `applyViewportVars()`. Dock rails,
 * mobile utility chrome, and other overlays should consume **only** this CSS
 * variable (via `startUiManager()`), not duplicate math — and should mirror
 * the dock pattern: compensate **insets** with `× var(--blemmy-ui-zoom-comp)`
 * on the outer anchor, apply `transform: scale(var(--blemmy-ui-zoom-comp))` on
 * an **inner** shell only (never both transforms on the same box).
 *
 * Full-bleed strips also need `width: calc(100% * var(--blemmy-vv-scale))` on
 * that shell (and flex centering) so `scale(var(--blemmy-ui-zoom-comp))` does not
 * shrink the bar to a fraction of the column width.
 */

import {
	clientCssDeltaToLayoutTransformShift,
	dockPeekSlideLayoutPx,
	pinchZoomScale,
	uiZoomCompensation,
} from '@renderer/viewport-space';

const UI_VIEWPORT_EVENT = 'blemmy-ui-viewport-changed';

/**
 * Extra strip clearance in *client-reference* CSS px (with σ=1 convention:
 * same kind of pixel as apparent width after pinch compensations).
 */
const PEEK_SLIDE_CLEAR_REF_PX = 58;
const PEEK_GAP_REF_PX = 6;

const DOCK_LEFT_SHELL_SEL = '#blemmy-ui-dock-left .blemmy-ui-dock__zoom-shell';
const DOCK_RIGHT_SHELL_SEL = '#blemmy-ui-dock-right .blemmy-ui-dock__zoom-shell';
const DOCK_LEFT_HANDLE_SEL = '#blemmy-ui-dock-left-handle';
const DOCK_RIGHT_HANDLE_SEL = '#blemmy-ui-dock-right-handle';

let started = false;
let dockPeekRo: ResizeObserver | null = null;

/** Slide = gbcr width (already ~W/σ) + clearance mapped to layout (`m/σ`). */
function readShellSlideLayoutPx(shell: HTMLElement | null): number | null {
	if (!shell) { return null; }
	const paintedLayoutW = shell.getBoundingClientRect().width;
	if (paintedLayoutW <= 0.5) { return null; }
	const marginLayout = clientCssDeltaToLayoutTransformShift(
		PEEK_SLIDE_CLEAR_REF_PX,
	);
	return paintedLayoutW + marginLayout;
}

/**
 * Collapsed base offset from anchor edge:
 * painted handle width + fixed visual gap.
 */
function readHandleSpaceLayoutPx(handle: HTMLElement | null): number | null {
	if (!handle) { return null; }
	const paintedLayoutW = handle.getBoundingClientRect().width;
	if (paintedLayoutW <= 0.5) { return null; }
	const gapLayout = clientCssDeltaToLayoutTransformShift(PEEK_GAP_REF_PX);
	return paintedLayoutW + gapLayout;
}

function updateDockPeekSlideDistances(): void {
	const root = document.documentElement;
	const fallback = dockPeekSlideLayoutPx({
		paintedLayoutWidth: 70,
		clearanceClientRefPx: PEEK_SLIDE_CLEAR_REF_PX,
		scale: pinchZoomScale(),
	});
	const left = readShellSlideLayoutPx(
		document.querySelector(DOCK_LEFT_SHELL_SEL),
	);
	const right = readShellSlideLayoutPx(
		document.querySelector(DOCK_RIGHT_SHELL_SEL),
	);
	root.style.setProperty(
		'--blemmy-dock-peek-slide-l',
		`${left ?? fallback}px`,
	);
	root.style.setProperty(
		'--blemmy-dock-peek-slide-r',
		`${right ?? fallback}px`,
	);
	const handleFallback =
		12 + clientCssDeltaToLayoutTransformShift(PEEK_GAP_REF_PX);
	const leftHandleSpace = readHandleSpaceLayoutPx(
		document.querySelector(DOCK_LEFT_HANDLE_SEL),
	);
	const rightHandleSpace = readHandleSpaceLayoutPx(
		document.querySelector(DOCK_RIGHT_HANDLE_SEL),
	);
	root.style.setProperty(
		'--blemmy-dock-peek-handle-space-l',
		`${leftHandleSpace ?? handleFallback}px`,
	);
	root.style.setProperty(
		'--blemmy-dock-peek-handle-space-r',
		`${rightHandleSpace ?? handleFallback}px`,
	);

	const leftShell = document.querySelector(DOCK_LEFT_SHELL_SEL);
	const rightShell = document.querySelector(DOCK_RIGHT_SHELL_SEL);
	const leftHandle = document.querySelector(DOCK_LEFT_HANDLE_SEL);
	const rightHandle = document.querySelector(DOCK_RIGHT_HANDLE_SEL);
	if (
		(!leftShell && !rightShell && !leftHandle && !rightHandle) ||
		dockPeekRo
	) {
		return;
	}
	dockPeekRo = new ResizeObserver(() => {
		updateDockPeekSlideDistances();
	});
	if (leftShell) { dockPeekRo.observe(leftShell); }
	if (rightShell) { dockPeekRo.observe(rightShell); }
	if (leftHandle) { dockPeekRo.observe(leftHandle); }
	if (rightHandle) { dockPeekRo.observe(rightHandle); }
}

/**
 * Recompute peek slide distances after dock layout or mode changes.
 * Safe before/after shells mount.
 */
export function refreshDockPeekSlide(): void {
	updateDockPeekSlideDistances();
}

function applyViewportVars(): void {
	const root = document.documentElement;
	const vv = window.visualViewport;
	if (!vv) {
		root.style.setProperty('--blemmy-vv-top', '0px');
		root.style.setProperty('--blemmy-vv-left', '0px');
		root.style.setProperty('--blemmy-vv-right', '0px');
		root.style.setProperty('--blemmy-vv-bottom', '0px');
		root.style.setProperty('--blemmy-vv-width', `${window.innerWidth}px`);
		root.style.setProperty('--blemmy-vv-height', `${window.innerHeight}px`);
		root.style.setProperty('--blemmy-vv-scale', '1');
		root.style.setProperty('--blemmy-ui-zoom-comp', '1');
		root.style.setProperty('--blemmy-dock-peek-gap', '6px');
		updateDockPeekSlideDistances();
		window.dispatchEvent(new CustomEvent(UI_VIEWPORT_EVENT));
		return;
	}

	const left = Math.max(0, vv.offsetLeft);
	const top = Math.max(0, vv.offsetTop);
	const scale = pinchZoomScale();
	const right = Math.max(0, window.innerWidth - (vv.offsetLeft + vv.width));
	const bottom = Math.max(
		0,
		window.innerHeight - (vv.offsetTop + vv.height),
	);
	const zoomComp = uiZoomCompensation();
	const peekGap = Math.max(
		4,
		Math.round(clientCssDeltaToLayoutTransformShift(6)),
	);

	root.style.setProperty('--blemmy-vv-top', `${top}px`);
	root.style.setProperty('--blemmy-vv-left', `${left}px`);
	root.style.setProperty('--blemmy-vv-right', `${right}px`);
	root.style.setProperty('--blemmy-vv-bottom', `${bottom}px`);
	root.style.setProperty('--blemmy-vv-width', `${vv.width}px`);
	root.style.setProperty('--blemmy-vv-height', `${vv.height}px`);
	root.style.setProperty('--blemmy-vv-scale', `${scale}`);
	root.style.setProperty('--blemmy-ui-zoom-comp', `${zoomComp}`);
	root.style.setProperty('--blemmy-dock-peek-gap', `${peekGap}px`);
	updateDockPeekSlideDistances();
	window.dispatchEvent(new CustomEvent(UI_VIEWPORT_EVENT));
}

export function startUiManager(): void {
	if (started) { return; }
	started = true;
	applyViewportVars();
	window.addEventListener('resize', applyViewportVars);
	window.addEventListener('scroll', applyViewportVars, true);
	window.visualViewport?.addEventListener('resize', applyViewportVars);
	window.visualViewport?.addEventListener('scroll', applyViewportVars);
}

export {
	clientCssDeltaToLayoutTransformShift,
	clientDeltaToLayoutShift,
	dockPeekSlideLayoutPx,
	elementLayoutBorderWidth,
	layoutShiftToClientDelta,
	layoutTransformShiftToClientCssDelta,
	MIN_PINCH_SCALE,
	normalizePinchScale,
	pinchZoomScale,
	uiZoomCompensation,
	uiZoomCompFromScale,
} from '@renderer/viewport-space';


