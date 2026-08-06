import type { ChatFlowKey } from "../chat.types";

/**
 * Registro dos fluxos de atendimento da APCS (ver docs/ROADMAP.md, Fase 4).
 *
 * Só o CSP está implementado. Os demais aparecem aqui como roadmap: quando um
 * fluxo novo for construído, ele vira `available: true` e ganha seu próprio
 * `<flow>.content.ts` + `<flow>.flow.ts` — sem tocar no motor.
 */

export interface ChatFlowDefinition {
  /** `null` enquanto o fluxo não existe no banco (enum `chat_flow_key`). */
  key: ChatFlowKey | null;
  /** Rótulo PT-BR exibido no menu do chat. */
  title: string;
  available: boolean;
}

export const CHAT_FLOWS: readonly ChatFlowDefinition[] = [
  { key: "csp", title: "CSP — compras coletivas", available: true },
  { key: null, title: "Eventos", available: false },
  { key: null, title: "Filiação", available: false },
  { key: null, title: "Bolsa de Suínos", available: false },
  { key: null, title: "Selo Suíno Paulista", available: false },
  { key: null, title: "Imprensa e Parcerias", available: false },
];

/** Fluxo padrão do MVP — toda conversa nova começa por ele. */
export const DEFAULT_FLOW_KEY: ChatFlowKey = "csp";
