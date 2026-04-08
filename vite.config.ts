import { defineConfig } from 'vite';
import { resolve }      from 'path';

function normalizedBase(): string {
	const raw = process.env.CV_BASE_URL?.trim();
	if (!raw) { return '/'; }

	// GitHub Pages custom domains often map the site to `/` (no repo subpath).
	// Using relative assets (`./`) makes the build work both at `/` and
	// at `/repo-name/`.
	if (raw === '.' || raw === './') { return './'; }
	if (raw.startsWith('./')) {
		return raw.endsWith('/') ? raw : `${raw}/`;
	}
	if (raw.startsWith('/')) {
		return raw.endsWith('/') ? raw : `${raw}/`;
	}

	// Treat a bare folder name like "blemmy" as an absolute subpath.
	const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
	return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export default defineConfig({
	base: normalizedBase(),
	// Uncommon port to avoid clashing with other Vite apps (default 5173).
	// Set Supabase Auth redirect URLs to http://localhost:5923 (and /** if needed).
	server: { port: 5923, strictPort: true },
	resolve: {
		alias: {
			'@lib':        resolve(__dirname, 'src/lib'),
			'@lib/engine': resolve(__dirname, 'src/lib/engine'),
			'@data':       resolve(__dirname, 'src/data'),
			'@types':      resolve(__dirname, 'src/types'),
			'@cv':         resolve(__dirname, 'src/types'),
			'@styles':     resolve(__dirname, 'src/styles'),
			'@renderer':   resolve(__dirname, 'src/renderer'),
		},
	},
	build: {
		outDir:      'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				app:       resolve(__dirname, 'index.html'),
				embedDemo: resolve(__dirname, 'embed-demo.html'),
				blemmyDoc: resolve(__dirname, 'src/embed/blemmy-doc-entry.ts'),
			},
			output: {
				entryFileNames(chunkInfo) {
					const id = chunkInfo.facadeModuleId ?? '';
					if (id.endsWith('blemmy-doc-entry.ts')) {
						return 'blemmy-doc.js';
					}
					return 'assets/[name]-[hash].js';
				},
			},
		},
	},
	// Expose both prefixes — a single string replaces the default `VITE_` and would
	// hide `VITE_SUPABASE_*` from import.meta.env.
	envPrefix: ['VITE_', 'CV_'],
});
