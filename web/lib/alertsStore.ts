// Persistencia de las alertas del piloto — un solo archivo JSON, más reciente primero.
// Solo servidor.

import { promises as fs } from "fs";
import path from "path";
import type { Alert } from "./alerts";
import { notifyDiscord } from "./discord";

const DATA_FILE = path.join(process.cwd(), "data", "alerts", "alerts.json");
/** Tope de alertas guardadas — es un feed, no un archivo histórico completo. */
const MAX_ALERTS = 300;

interface StoredFile {
  updatedAt: string;
  alerts: Alert[];
}

export async function loadAlerts(): Promise<Alert[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredFile;
    return Array.isArray(parsed.alerts) ? parsed.alerts : [];
  } catch {
    return [];
  }
}

export async function appendAlert(alert: Alert): Promise<Alert[]> {
  const existing = await loadAlerts();
  const alerts = [alert, ...existing].slice(0, MAX_ALERTS);
  const payload: StoredFile = { updatedAt: new Date().toISOString(), alerts };
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
  await notifyDiscord(alert);
  return alerts;
}
