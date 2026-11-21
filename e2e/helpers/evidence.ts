import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Page, test } from '@playwright/test';
import { EVIDENCE_DIR } from './env';

/**
 * Bukti QA: screenshot viewport (bukan fullPage, supaya kecil) dan log JSON di `e2e/evidence-out/`,
 * di-upload sebagai artifact `e2e-evidence`. Nama file diawali kode gate, mis. `gate1-03-proposal.png`.
 */
export async function shot(page: Page, name: string) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `${name}.png`);
  // Tunggu animasi/spinner kecil reda supaya bukti terbaca.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
  return file;
}

/** Gulir sampai elemen berada di atas viewport (bukti yang relevan masuk screenshot). */
export async function scrollToTop(locator: import('@playwright/test').Locator) {
  await locator.first().evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -80); // header aplikasi sticky
  });
}

export function writeJson(name: string, data: unknown) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `${name}.json`);
  // `onchainKey` (bytes32 publik) dibuang: polanya memicu false positive gitleaks generic-api-key
  // saat bukti di-commit ke docs/qa/evidence.
  fs.writeFileSync(file, JSON.stringify(data, (k, v) => (k === 'onchainKey' ? undefined : v), 2));
  return file;
}

export type StepStatus = 'PASS' | 'FAIL' | 'NOT_RUN';

export interface StepRecord {
  id: string;
  name: string;
  expected: string;
  status: StepStatus;
  actual?: string;
  error?: string;
  durationMs?: number;
  evidence?: string[];
}

/**
 * Pencatat langkah (expected vs actual, PASS/FAIL) untuk dokumen QA. Langkah yang gagal tetap dicatat
 * lalu error dilempar ulang supaya test gagal; langkah sesudahnya tercatat NOT_RUN.
 */
export class StepLog {
  readonly steps: StepRecord[] = [];

  constructor(
    readonly name: string,
    plan: { id: string; name: string; expected: string }[],
  ) {
    this.steps = plan.map((p) => ({ ...p, status: 'NOT_RUN' as StepStatus }));
  }

  async run(id: string, fn: (rec: StepRecord) => Promise<string | void>) {
    const rec = this.steps.find((s) => s.id === id);
    if (!rec) throw new Error(`Langkah ${id} tidak ada di rencana ${this.name}`);
    const started = Date.now();
    await test.step(`${id} ${rec.name}`, async () => {
      try {
        const actual = await fn(rec);
        rec.status = 'PASS';
        rec.actual = actual || rec.expected;
      } catch (e) {
        rec.status = 'FAIL';
        rec.error = e instanceof Error ? e.message.slice(0, 1500) : String(e);
        throw e;
      } finally {
        rec.durationMs = Date.now() - started;
        this.flush();
      }
    });
  }

  flush() {
    const summary = {
      name: this.name,
      generatedAt: new Date().toISOString(),
      runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
      commit: process.env.GITHUB_SHA ?? null,
      pass: this.steps.filter((s) => s.status === 'PASS').length,
      fail: this.steps.filter((s) => s.status === 'FAIL').length,
      notRun: this.steps.filter((s) => s.status === 'NOT_RUN').length,
      steps: this.steps,
    };
    writeJson(this.name, summary);
  }
}
