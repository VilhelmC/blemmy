/**
 * blemmy-file-reader.ts
 *
 * Reads uploaded document files to plain text so the chatbot can use them
 * as source material to generate or update a CV.
 *
 * Supported formats:
 *   .txt / .md   — read directly as UTF-8 text
 *   .docx        — extracted via mammoth.js (converts Word XML to plain text)
 *   .pdf         — best-effort text extraction via browser PDF APIs or raw text
 *                  search (works for text-based PDFs, not scanned images)
 *
 * Usage:
 *   const text = await readFileToText(file);
 *   // text is clean plain text ready to send to the LLM
 *
 * mammoth is loaded dynamically on first .docx use so it doesn't bloat the
 * initial bundle for users who never upload Word files.
 */

export type ReadResult =
	| { ok: true;  text: string; format: string }
	| { ok: false; error: string };

// ─── Plain text ───────────────────────────────────────────────────────────────

function readAsText(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader  = new FileReader();
		reader.onload = (e) => resolve(e.target?.result as string ?? '');
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsText(file, 'utf-8');
	});
}

// ─── DOCX via mammoth ─────────────────────────────────────────────────────────

type MammothLib = { extractRawText: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };

async function readDocx(file: File): Promise<string> {
	let mammoth: MammothLib | null = null;

	try {
		const mod = await import('mammoth');
		mammoth = (mod.default ?? mod) as MammothLib;
	} catch {
		try {
			// CDN fallback
			const cdnUrl = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
			const mod = await import(/* @vite-ignore */ cdnUrl as string);
			mammoth = (mod.default ?? mod) as MammothLib;
		} catch {
			throw new Error(
				'Could not load .docx reader. Run npm install to install dependencies, or convert your file to .txt first.'
			);
		}
	}

	if (!mammoth) { throw new Error('mammoth library failed to load.'); }

	const buf    = await file.arrayBuffer();
	const result = await mammoth.extractRawText({ arrayBuffer: buf });
	return result.value ?? '';
}

// ─── PDF best-effort ──────────────────────────────────────────────────────────

/**
 * Attempts to extract text from a PDF using the browser's built-in PDF
 * viewer APIs (Chrome/Edge) or by reading the raw bytes and pulling ASCII
 * text runs — crude but covers most text-based CVs and LinkedIn exports.
 *
 * For scanned PDFs this will return empty or garbage. We surface a clear
 * error so the user can try copy-pasting instead.
 */
async function readPdf(file: File): Promise<string> {
	// Try PDF.js from CDN (works for text-based PDFs in any browser)
	try {
		const pdfjsUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pdfjsLib = await import(/* @vite-ignore */ pdfjsUrl as string) as any;

		// Point to the worker
		pdfjsLib.GlobalWorkerOptions.workerSrc =
			'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';

		const buf  = await file.arrayBuffer();
		const doc  = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
		const lines: string[] = [];

		for (let p = 1; p <= doc.numPages; p++) {
			const page    = await doc.getPage(p);
			const content = await page.getTextContent();
			const pageText = content.items
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.map((item: any) => item.str ?? '')
				.join(' ');
			if (pageText.trim()) { lines.push(pageText); }
		}

		return lines.join('\n\n');
	} catch {
		throw new Error(
			'Could not extract text from this PDF. ' +
			'Try copy-pasting the text directly into the chat, or export as .docx or .txt.'
		);
	}
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** File size limit: 4MB — large enough for any CV document. */
const MAX_FILE_SIZE = 4 * 1024 * 1024;

/** Text length limit sent to the LLM: ~30k chars ≈ ~7500 tokens. */
const MAX_TEXT_LENGTH = 30_000;

/**
 * Reads an uploaded file to plain text, ready for use as LLM context.
 * Handles .txt, .md, .docx, .pdf.
 */
export async function readFileToText(file: File): Promise<ReadResult> {
	if (file.size > MAX_FILE_SIZE) {
		return {
			ok:    false,
			error: `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 4 MB.`,
		};
	}

	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

	let text: string;

	try {
		if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
			text = await readAsText(file);
		} else if (ext === 'docx') {
			text = await readDocx(file);
		} else if (ext === 'pdf') {
			text = await readPdf(file);
		} else {
			// Try reading as text anyway — useful for .rtf, .csv, etc.
			text = await readAsText(file);
		}
	} catch (err) {
		return {
			ok:    false,
			error: err instanceof Error ? err.message : 'Could not read file.',
		};
	}

	// Trim and enforce length limit
	const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

	if (cleaned.length === 0) {
		return {
			ok:    false,
			error: 'No readable text found in the file. Try copy-pasting the content directly.',
		};
	}

	const truncated = cleaned.length > MAX_TEXT_LENGTH
		? cleaned.slice(0, MAX_TEXT_LENGTH) + '\n\n[… truncated to fit context window]'
		: cleaned;

	return { ok: true, text: truncated, format: ext || 'text' };
}

/**
 * Accepted MIME types and extensions for the file input.
 */
export const ACCEPTED_FILE_TYPES =
	'.txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,' +
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
	'application/pdf';

