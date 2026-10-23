import { Logger } from '@nestjs/common';
import { env } from './env';

const logger = new Logger('Alert');

/**
 * Alert operasional: selalu ditulis ke log; kalau ALERT_WEBHOOK_URL diisi, juga dikirim ke Discord.
 * Tidak pernah melempar error — gagal kirim alert tidak boleh menghentikan worker.
 */
export async function sendAlert(message: string): Promise<boolean> {
  logger.error(message);
  const url = env().alerts.webhookUrl;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Discord membatasi content 2000 karakter.
      body: JSON.stringify({ content: message.slice(0, 1900) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn(`Webhook alert gagal: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    logger.warn(`Webhook alert gagal: ${(e as Error).message}`);
    return false;
  }
}
