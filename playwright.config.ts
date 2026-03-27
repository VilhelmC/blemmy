import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';

/** One Vite dev server — cap local workers so navigation stays reliable. */
const localWorkers = Math.max(1, Math.min(8, os.cpus().length));

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	workers: process.env.CI ? 2 : localWorkers,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: 'http://127.0.0.1:4173',
		actionTimeout: 25_000,
		navigationTimeout: 120_000,
		trace: 'on-first-retry',
		video: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	webServer: {
		command: 'npm run dev -- --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
