import { CFG } from './common.mjs';

export async function sendAlert({ type, message, data }) {
  if (!CFG.alertWebhookUrl) return;

  const payload = {
    embeds: [
      {
        title: type,
        description: message,
        color: type === 'trade' ? 0x00ff00 : type === 'error' ? 0xff0000 : 0x0000ff,
        fields: data ? [{ name: 'Data', value: JSON.stringify(data).slice(0, 1024) }] : [],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    await fetch(CFG.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
  } catch {
    // Fire-and-forget: never throw
  }
}
