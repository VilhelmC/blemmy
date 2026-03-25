import { defineConfig } from 'vitest/config';
import { resolve }      from 'path';

export default defineConfig({
	test: {
		environment: 'node',
		include:      ['src/**/*.test.ts'],
	},
	resolve: {
		alias: {
			'@lib':      resolve(__dirname, 'src/lib'),
			'@data':     resolve(__dirname, 'src/data'),
			'@types':    resolve(__dirname, 'src/types'),
			'@styles':   resolve(__dirname, 'src/styles'),
			'@renderer': resolve(__dirname, 'src/renderer'),
			'@cv':       resolve(__dirname, 'src/types'),
		},
	},
});
