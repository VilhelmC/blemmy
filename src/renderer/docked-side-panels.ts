export const DOCKED_SIDE_PANEL_CLASS = 'cv-unified-side-panel';
export const MOBILE_DOCKED_PANEL_MQ = '(max-width: 900px)';
export const MOBILE_DOCKED_PANEL_HOST_ID = 'cv-mobile-docked-panel-flow';
export const RIGHT_DOCKED_PANEL_IDS = [
	'cv-edit-panel',
	'blemmy-review-panel',
	'cv-chat-panel',
] as const;
export type RightDockedPanelId = (typeof RIGHT_DOCKED_PANEL_IDS)[number];
export const DOCKED_PANEL_OPEN_EVENT = 'cv-docked-panel-open';
export const DOCKED_PANEL_CLOSE_EVENT = 'cv-docked-panel-close';

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
	host.className = 'cv-mobile-docked-panel-flow no-print';
	host.hidden = true;
	const root = document.getElementById('cv-root');
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
			document.documentElement.classList.add('cv-mobile-docked-panel-open');
			return;
		}

		host.hidden = true;
		document.documentElement.classList.remove('cv-mobile-docked-panel-open');
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
			document.documentElement.classList.remove('cv-mobile-docked-panel-open');
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
