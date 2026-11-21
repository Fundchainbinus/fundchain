import { defineConfig, devices } from '@playwright/test';
import { WEB_URL, assertLocalStack } from './helpers/env';

// Fail-closed: harness hanya boleh menyentuh stack lokal sekali pakai.
assertLocalStack();

/**
 * Urutan file = urutan gate (00 → 06). Satu worker supaya state seed/DB tidak saling balapan dan
 * rate limit per-IP API tetap bisa diprediksi. Setiap file memakai X-Forwarded-For sendiri
 * (API mempercayai proxy loopback di non-production) supaya bucket throttle tidak saling mengganggu.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: './test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
    ['json', { outputFile: './evidence-out/playwright-results.json' }],
  ],
  use: {
    baseURL: WEB_URL,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'gates',
      testIgnore: /05-dry-run/,
    },
    {
      // Gate 3 / BFD-70: gladi bersih demo direkam (video + trace selalu disimpan).
      name: 'dry-run',
      // Tanpa `dependencies`: gladi tetap jalan (dan tercatat) walau ada gate lain yang gagal.
      testMatch: /05-dry-run/,
      use: { video: 'on', trace: 'on' },
    },
  ],
});
