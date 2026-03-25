import { defineConfig } from 'vite';
import { resolve }      from 'path';

function normalizedBase(): string {
	const raw = process.env.CV_BASE_URL?.trim();
	if (!raw) { return '/'; }
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
			'@lib':      resolve(__dirname, 'src/lib'),
			'@data':     resolve(__dirname, 'src/data'),
			'@types':    resolve(__dirname, 'src/types'),
			'@styles':   resolve(__dirname, 'src/styles'),
			'@renderer': resolve(__dirname, 'src/renderer'),
		},
	},
	build: {
		outDir:      'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: resolve(__dirname, 'index.html'),
		},
	},
	// Expose both prefixes — a single string replaces the default `VITE_` and would
	// hide `VITE_SUPABASE_*` from import.meta.env.
	envPrefix: ['VITE_', 'CV_'],
});
