import { describe, expect, it, vi } from "vitest";
import type { Alert } from "./alerts";
import { buildDiscordPayload, notifyDiscord } from "./discord";

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "al_1",
    ticker: "TSLA",
    path: "intraday",
    direction: "up",
    probability: 78,
    reasoning: "GEX confianza 78% + ruptura de resistencia en $330.00 (fuerza 60).",
    tradeId: "tr_1",
    createdAt: "2026-08-10T14:00:00.000Z",
    ...overrides,
  };
}

describe("buildDiscordPayload", () => {
  it("arma un embed con ticker, dirección y razón", () => {
    const payload = buildDiscordPayload(alert());
    const embed = (payload.embeds as Record<string, unknown>[])[0];
    expect(embed.title).toContain("TSLA");
    expect(embed.title).toContain("Alcista");
    expect(embed.description).toBe(alert().reasoning);
    expect(embed.color).toBe(0x22c55e);
  });

  it("usa color rojo para direcciones bajistas", () => {
    const payload = buildDiscordPayload(alert({ direction: "down" }));
    const embed = (payload.embeds as Record<string, unknown>[])[0];
    expect(embed.color).toBe(0xef4444);
  });

  it("declara que es simulación en el footer", () => {
    const payload = buildDiscordPayload(alert());
    const embed = (payload.embeds as Record<string, unknown>[])[0];
    expect((embed.footer as { text: string }).text).toMatch(/SIMULACIÓN/i);
  });
});

describe("notifyDiscord", () => {
  it("no llama a fetch si no hay DISCORD_WEBHOOK_URL configurado", async () => {
    const prev = process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    const fetchImpl = vi.fn();
    await notifyDiscord(alert(), fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    if (prev !== undefined) process.env.DISCORD_WEBHOOK_URL = prev;
  });

  it("hace POST al webhook con el payload cuando sí está configurado", async () => {
    const prev = process.env.DISCORD_WEBHOOK_URL;
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    await notifyDiscord(alert(), fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/test",
      expect.objectContaining({ method: "POST" }),
    );
    if (prev !== undefined) process.env.DISCORD_WEBHOOK_URL = prev;
    else delete process.env.DISCORD_WEBHOOK_URL;
  });

  it("no lanza si el fetch falla (red caída, webhook mal puesto, etc.)", async () => {
    const prev = process.env.DISCORD_WEBHOOK_URL;
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(notifyDiscord(alert(), fetchImpl as unknown as typeof fetch)).resolves.toBeUndefined();
    if (prev !== undefined) process.env.DISCORD_WEBHOOK_URL = prev;
    else delete process.env.DISCORD_WEBHOOK_URL;
  });
});
