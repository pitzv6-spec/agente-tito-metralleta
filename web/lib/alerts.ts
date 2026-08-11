// Alertas del piloto automático — SIMULACIÓN. Cada alerta corresponde a un trade
// AUTO que el piloto ya creó en Mis Trades; esto es el feed de "qué hizo y por qué".

import type { AutoPath } from "./autopilot";
import type { Direction } from "./paperTrades";

export interface Alert {
  id: string;
  ticker: string;
  path: AutoPath;
  direction: Direction;
  probability: number;
  reasoning: string;
  tradeId: string;
  createdAt: string;
}

export type AlertInput = Omit<Alert, "id" | "createdAt">;

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `al_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createAlert(input: AlertInput, now: Date = new Date()): Alert {
  return { id: genId(), createdAt: now.toISOString(), ...input };
}
