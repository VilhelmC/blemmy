import { BLEMMY_DOC_ROOT_ID } from '@lib/blemmy-dom-ids';

export const DOCKED_SIDE_PANEL_CLASS = 'blemmy-unified-side-panel';
export const MOBILE_DOCKED_PANEL_MQ = '(max-width: 900px)';
export const MOBILE_DOCKED_PANEL_HOST_ID = 'blemmy-mobile-docked-panel-flow';
export const RIGHT_DOCKED_PANEL_IDS = [
	'blemmy-edit-panel',
	'blemmy-review-panel',
	'blemmy-chat-panel',
] as const;
export type RightDockedPanelId = (typeof RIGHT_DOCKED_PANEL_IDS)[number];
export const DOCKED_PANEL_OPEN_EVENT = 'blemmy-docked-panel-open';
export const DOCKED_PANEL_CLOSE_EVENT = 'blemmy-docked-panel-close';

type DockedSidePanelFlowOptions = {
	getPanels: () => Array<HTMLElement>;
};

type DockedSidePanelFlow = {
	sync: () => void;
	destroy: () => void;
};

function ensureHost(): HTMLElement {
	let host = document.getElementById(MOBILE_DOCKED_PANEL_HOST_ID);
	if (host instanceof HTMLElement) { return host; }
	host = document.createElement('div');
	host.id = MOBILE_DOCKED_PANEL_HOST_ID;
	host.className = 'blemmy-mobile-docked-panel-flow no-print';
	host.hidden = true;
	const root = document.getElementById(BLEMMY_DOC_ROOT_ID);
	if (root?.parentElement) {
		root.parentElement.insertBefore(host, root.nextSibling);
	} else {
		document.body.appendChild(host);
	}
	return host;
}

function isOpenPanel(panel: HTMLElement): boolean {
	return !panel.hasAttribute('hidden');
}

export function initDockedSidePanelFlow(
	options: DockedSidePanelFlowOptions,
): DockedSidePanelFlow {
	const mq = window.matchMedia(MOBILE_DOCKED_PANEL_MQ);
	const host = ensureHost();

	const sync = (): void => {
		const panels = options.getPanels();
		const mobile = mq.matches;
		const openPanel = panels.find((p) => isOpenPanel(p)) ?? null;

		if (mobile && openPanel) {
			if (openPanel.parentElement !== host) {
				host.appendChild(openPanel);
			}
			host.hidden = false;
			document.documentElement.classList.add('blemmy-mobile-docked-panel-open');
			return;
		}

		host.hidden = true;
		document.documentElement.classList.remove('blemmy-mobile-docked-panel-open');
		for (const panel of panels) {
			if (panel.parentElement === host) {
				document.body.appendChild(panel);
			}
		}
	};

	const observer = new MutationObserver(() => { sync(); });
	observer.observe(document.body, {
		subtree: true,
		childList: true,
	});
	window.addEventListener('resize', sync);
	window.visualViewport?.addEventListener('resize', sync);
	if (typeof mq.addEventListener === 'function') {
		mq.addEventListener('change', sync);
	} else {
		mq.addListener(sync);
	}

	sync();

	return {
		sync,
		destroy: () => {
			observer.disconnect();
			window.removeEventListener('resize', sync);
			window.visualViewport?.removeEventListener('resize', sync);
			if (typeof mq.removeEventListener === 'function') {
				mq.removeEventListener('change', sync);
			} else {
				mq.removeListener(sync);
			}
			document.documentElement.classList.remove('blemmy-mobile-docked-panel-open');
		},
	};
}

export function dispatchDockedPanelOpen(panelId: RightDockedPanelId): void {
	window.dispatchEvent(new CustomEvent(DOCKED_PANEL_OPEN_EVENT, {
		detail: { panelId },
	}));
}

export function dispatchDockedPanelClose(panelId: RightDockedPanelId): void {
	window.dispatchEvent(new CustomEvent(DOCKED_PANEL_CLOSE_EVENT, {
		detail: { panelId },
	}));
}
