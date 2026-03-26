/**
 * Resize and compress a user portrait for `basics.portraitDataUrl` (app + sync).
 * Browser-only (canvas + ImageBitmap).
 */

const MAX_SIDE_PX = 512;
/** ~330 KiB base64 — keeps document_versions rows reasonable. */
const MAX_DATA_URL_CHARS = 450_000;
const LOCAL_PORTRAIT_KEY = 'cv-portrait-cache';
const IDB_NAME = 'cv-local-cache';
const IDB_STORE = 'kv';
const IDB_PORTRAIT_KEY = 'portraitDataUrl';

/**
 * Downscales and re-encodes as JPEG, shrinking quality and size until under
 * {@link MAX_DATA_URL_CHARS} or limits are hit.
 */
export async function processPortraitFile(file: File): Promise<string> {
	if (!file.type.startsWith('image/')) {
		throw new Error('Choose an image file.');
	}
	const bmp = await createImageBitmap(file);
	try {
		let cw = bmp.width;
		let ch = bmp.height;
		const scale0 = Math.min(1, MAX_SIDE_PX / Math.max(cw, ch));
		cw = Math.max(1, Math.round(cw * scale0));
		ch = Math.max(1, Math.round(ch * scale0));

		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Canvas not available.');
		}

		let q = 0.88;
		let url = '';
		for (let attempt = 0; attempt < 18; attempt++) {
			canvas.width = cw;
			canvas.height = ch;
			ctx.drawImage(bmp, 0, 0, cw, ch);
			url = canvas.toDataURL('image/jpeg', q);
			if (url.length <= MAX_DATA_URL_CHARS) {
				return url;
			}
			if (q > 0.52) {
				q -= 0.06;
				continue;
			}
			cw = Math.max(48, Math.floor(cw * 0.9));
			ch = Math.max(48, Math.floor(ch * 0.9));
			q = 0.82;
		}
		throw new Error(
			'Portrait is still too large after compression; try a smaller image.',
		);
	} finally {
		bmp.close();
	}
}

export const CV_PORTRAIT_DATA_URL_MAX_CHARS = MAX_DATA_URL_CHARS;

function canUseLocalStorage(): boolean {
	try {
		return typeof localStorage !== 'undefined';
	} catch {
		return false;
	}
}

function idbAvailable(): boolean {
	return typeof indexedDB !== 'undefined';
}

function openPortraitDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(IDB_STORE)) {
				db.createObjectStore(IDB_STORE);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
	});
}

export async function savePortraitLocalCache(dataUrl: string): Promise<void> {
	if (!dataUrl || !dataUrl.startsWith('data:image/')) {
		return;
	}
	if (canUseLocalStorage()) {
		try {
			localStorage.setItem(LOCAL_PORTRAIT_KEY, dataUrl);
			return;
		} catch {
			/* quota/full; fall through to IndexedDB */
		}
	}
	if (!idbAvailable()) {
		return;
	}
	try {
		const db = await openPortraitDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.objectStore(IDB_STORE).put(dataUrl, IDB_PORTRAIT_KEY);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
		});
		db.close();
	} catch {
		/* best effort cache */
	}
}

export async function loadPortraitLocalCache(): Promise<string | null> {
	if (canUseLocalStorage()) {
		try {
			const v = localStorage.getItem(LOCAL_PORTRAIT_KEY);
			if (v && v.startsWith('data:image/')) {
				return v;
			}
		} catch {
			/* continue to IndexedDB */
		}
	}
	if (!idbAvailable()) {
		return null;
	}
	try {
		const db = await openPortraitDb();
		const value = await new Promise<string | null>((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readonly');
			const req = tx.objectStore(IDB_STORE).get(IDB_PORTRAIT_KEY);
			req.onsuccess = () => {
				const v = req.result;
				resolve(typeof v === 'string' && v.startsWith('data:image/') ? v : null);
			};
			req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
		});
		db.close();
		return value;
	} catch {
		return null;
	}
}

export async function clearPortraitLocalCache(): Promise<void> {
	if (canUseLocalStorage()) {
		try {
			localStorage.removeItem(LOCAL_PORTRAIT_KEY);
		} catch {
			/* noop */
		}
	}
	if (!idbAvailable()) {
		return;
	}
	try {
		const db = await openPortraitDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(IDB_STORE, 'readwrite');
			tx.objectStore(IDB_STORE).delete(IDB_PORTRAIT_KEY);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
		});
		db.close();
	} catch {
		/* noop */
	}
}
