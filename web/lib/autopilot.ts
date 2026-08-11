// Piloto automático — decide QUÉ abrir en paper trading, no CÓMO conseguir los datos
// (eso vive en la orquestación de app/api/autopilot/scan/route.ts). Funciones puras,
// testeadas, para que los umbrales y la lógica de selección se puedan verificar sin
// red ni disco.
//
// Dos vías, igual que pide el spec:
//   - intradía: confianza del mapa GEX + dirección + un nivel de soporte/resistencia
//     real (findLevels) como gatillo de ruptura.
//   - swing: flujo institucional inusual CON acierto histórico verificado (validation.ts)
//     — sin historial, el piloto no entra: no hay forma de sostener "alta probabilidad".
//
// SIMULACIÓN siempre: esto solo decide qué trade PAPER crear, nunca coloca una orden.

import type { ContractType, Direction, TradeInput, TradePath } from "./paperTrades";

/** Confianza mínima del mapa GEX (0-100, `gexAnalysis().confidence`) para autopilotear. */
export const MIN_INTRADAY_CONFIDENCE = 65;

/** Acierto histórico mínimo (0-100, `validationScore().hitRate.value`) para autopilotear swing. */
export const MIN_SWING_HITRATE = 60;

/** Casos resueltos mínimos para confiar en el acierto histórico de un ticker. */
export const MIN_SWING_SAMPLES = 3;

/** Ventana de vencimiento aceptable para el contrato que arma el piloto. */
export const MIN_CONTRACT_DTE = 7;
export const MAX_CONTRACT_DTE = 30;

/** Heurística de objetivo/stop declarada: +50% / −40% de la prima de referencia. */
export const AUTO_TARGET_MULT = 1.5;
export const AUTO_STOP_MULT = 0.6;
/** Asegura ganancia si la prima retrocede 25% desde su pico. */
export const AUTO_TRAILING_PCT = 25;

/** Confirmación para el gatillo del swing: cuánto debe seguir el subyacente al flow. */
export const SWING_CONFIRM_PCT = 0.3;

export interface ContractCandidate {
  strike: number;
  expiration: string;
  dte: number;
  bid: number | null;
  ask: number | null;
  lastTrade: number | null;
}

/** Precio de referencia de un contrato: mid si hay bid/ask, si no el último trade. */
export function refPrice(c: ContractCandidate): number | null {
  if (c.bid != null && c.ask != null && c.bid > 0 && c.ask > 0) return (c.bid + c.ask) / 2;
  return c.lastTrade != null && c.lastTrade > 0 ? c.lastTrade : null;
}

/** El contrato con precio disponible más cercano al strike objetivo, dentro de la ventana de DTE. */
export function pickNearestContract(
  candidates: ContractCandidate[],
  targetStrike: number,
): ContractCandidate | null {
  const usable = candidates.filter(
    (c) => c.dte >= MIN_CONTRACT_DTE && c.dte <= MAX_CONTRACT_DTE && refPrice(c) != null,
  );
  if (usable.length === 0) return null;
  return usable.sort(
    (a, b) => Math.abs(a.strike - targetStrike) - Math.abs(b.strike - targetStrike),
  )[0];
}

/** Alias local: la vía del piloto ES el `TradePath` que termina guardado en el trade. */
export type AutoPath = TradePath;

export interface AutoCandidate {
  ticker: string;
  path: AutoPath;
  direction: Direction;
  contractType: ContractType;
  strike: number;
  expiration: string;
  entryTrigger: number;
  probability: number; // 0-100
  reasoning: string;
  entryPriceRef: number; // prima de referencia al momento del escaneo (fija target/stop)
}

// ---------------------------------------------------------------------------
// Vía intradía — GEX + dirección + niveles
// ---------------------------------------------------------------------------

export interface KeyLevel {
  price: number;
  strength: number;
}

export interface IntradaySignal {
  ticker: string;
  spot: number;
  gexDirection: "up" | "down" | "flat" | null;
  gexConfidence: number;
  lowLiquidity: boolean;
  keySupport: KeyLevel | null;
  keyResistance: KeyLevel | null;
  contracts: ContractCandidate[];
}

export function evaluateIntraday(sig: IntradaySignal): AutoCandidate | null {
  if (sig.lowLiquidity) return null;
  if (sig.gexConfidence < MIN_INTRADAY_CONFIDENCE) return null;

  let direction: Direction;
  let contractType: ContractType;
  let entryTrigger: number;
  let levelWhy: string;

  if (sig.gexDirection === "up" && sig.keyResistance) {
    direction = "up";
    contractType = "call";
    entryTrigger = sig.keyResistance.price;
    levelWhy = `ruptura de resistencia en $${sig.keyResistance.price.toFixed(2)} (fuerza ${sig.keyResistance.strength})`;
  } else if (sig.gexDirection === "down" && sig.keySupport) {
    direction = "down";
    contractType = "put";
    entryTrigger = sig.keySupport.price;
    levelWhy = `ruptura de soporte en $${sig.keySupport.price.toFixed(2)} (fuerza ${sig.keySupport.strength})`;
  } else {
    return null; // sin nivel real que sostenga la dirección del GEX, no hay gatillo
  }

  const contract = pickNearestContract(sig.contracts, sig.spot);
  if (!contract) return null;
  const entryPriceRef = refPrice(contract);
  if (entryPriceRef == null) return null;

  return {
    ticker: sig.ticker,
    path: "intraday",
    direction,
    contractType,
    strike: contract.strike,
    expiration: contract.expiration,
    entryTrigger,
    probability: sig.gexConfidence,
    reasoning: `GEX confianza ${sig.gexConfidence}% + ${levelWhy}.`,
    entryPriceRef,
  };
}

// ---------------------------------------------------------------------------
// Vía swing — flujo institucional inusual + acierto histórico
// ---------------------------------------------------------------------------

export interface SwingSignal {
  ticker: string;
  type: ContractType;
  strike: number;
  expiration: string;
  assetPrice: number; // spot del subyacente cuando ocurrió el flow
  price: number; // prima del flow
  hitRate: number | null; // acierto histórico 0-100 (validationScore)
  resolved: number; // casos pasados usados para calcular el acierto
}

export function evaluateSwing(sig: SwingSignal): AutoCandidate | null {
  // Sin historial suficiente no hay forma honesta de sostener "acierto histórico":
  // el piloto se abstiene en vez de inventar una probabilidad.
  if (sig.hitRate == null || sig.resolved < MIN_SWING_SAMPLES) return null;
  if (sig.hitRate < MIN_SWING_HITRATE) return null;
  if (!(sig.price > 0)) return null;

  const direction: Direction = sig.type === "put" ? "down" : "up";
  const entryTrigger =
    direction === "up"
      ? sig.assetPrice * (1 + SWING_CONFIRM_PCT / 100)
      : sig.assetPrice * (1 - SWING_CONFIRM_PCT / 100);

  return {
    ticker: sig.ticker,
    path: "swing",
    direction,
    contractType: sig.type,
    strike: sig.strike,
    expiration: sig.expiration,
    entryTrigger,
    probability: sig.hitRate,
    reasoning: `Flujo institucional inusual — acierto histórico ${sig.hitRate.toFixed(0)}% sobre ${sig.resolved} casos.`,
    entryPriceRef: sig.price,
  };
}

// ---------------------------------------------------------------------------
// Candidato → plan de paper trade
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildAutoTradeInput(c: AutoCandidate): TradeInput {
  const pathLabel = c.path === "intraday" ? "Intradía · GEX + niveles" : "Swing · flujo institucional";
  return {
    ticker: c.ticker,
    contractType: c.contractType,
    strike: c.strike,
    expiration: c.expiration,
    direction: c.direction,
    entryTrigger: round2(c.entryTrigger),
    target: round2(c.entryPriceRef * AUTO_TARGET_MULT),
    stop: round2(c.entryPriceRef * AUTO_STOP_MULT),
    trailingStopPct: AUTO_TRAILING_PCT,
    probability: Math.round(c.probability),
    contracts: 1,
    source: "auto",
    path: c.path,
    note: `[${pathLabel}] ${c.reasoning}`,
  };
}
