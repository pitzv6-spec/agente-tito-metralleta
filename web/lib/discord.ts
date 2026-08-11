// Notifica las alertas del piloto automático a un canal de Discord vía webhook.
// Opcional: si DISCORD_WEBHOOK_URL no está configurado, no hace nada — nunca
// bloquea ni rompe el flujo de escaneo. Solo servidor.

import type { Alert } from "./alerts";

const PATH_LABEL: Record<Alert["path"], string> = {
  intraday: "Intradía · GEX + niveles",
  swing: "Swing · flujo institucional",
};

const DIRECTION_LABEL: Record<Alert["direction"], string> = {
  up: "🟢 Alcista",
  down: "🔴 Bajista",
};

const DIRECTION_COLOR: Record<Alert["direction"], number> = {
  up: 0x22c55e,
  down: 0xef4444,
};

export function buildDiscordPayload(alert: Alert): Record<string, unknown> {
  return {
    embeds: [
      {
        title: `${alert.ticker} — ${DIRECTION_LABEL[alert.direction]}`,
        description: alert.reasoning,
        color: DIRECTION_COLOR[alert.direction],
        fields: [
          { name: "Vía", value: PATH_LABEL[alert.path], inline: true },
          { name: "Probabilidad", value: `${alert.probability}%`, inline: true },
        ],
        footer: { text: "Tito Metralleta · Piloto automático — SIMULACIÓN, no coloca órdenes reales" },
        timestamp: alert.createdAt,
      },
    ],
  };
}

/** Envía la alerta al webhook de Discord. Nunca lanza — un fallo de red o webhook mal puesto no debe tumbar el escaneo. */
export async function notifyDiscord(alert: Alert, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDiscordPayload(alert)),
    });
    if (!res.ok) {
      console.error(`[discord] webhook respondió ${res.status} para la alerta de ${alert.ticker}`);
    }
  } catch (err) {
    console.error(
      `[discord] no se pudo enviar la alerta de ${alert.ticker}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
