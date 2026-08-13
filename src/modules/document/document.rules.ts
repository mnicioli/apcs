import { normalizeForSearch } from "@/lib/utils";
import type {
  DocumentFilters,
  DocumentSummary,
  DocumentVersion,
  DocumentVersionStatus,
} from "./document.types";

/**
 * As regras da gestão documental — puras, sem I/O, testáveis uma a uma.
 *
 * O que é regra de NEGÓCIO (uma versão ativa por vez, numeração que nunca
 * reusa) vive no banco, porque é lá que a garantia precisa valer mesmo com duas
 * telas concorrentes. O que está aqui é a leitura dessas regras: como ordenar,
 * como filtrar, o que exibir. `nextVersionNumber` espelha o que a função
 * `create_document_version` faz no Postgres, e existe para o comportamento
 * poder ser verificado sem banco.
 */

/** "v3" — a identidade funcional de uma versão (item 16 do escopo). */
export function versionLabel(version: number): string {
  return `v${version}`;
}

/**
 * O próximo número da sequência.
 *
 * É `maior + 1`, nunca `quantidade + 1`: versões não são apagadas, então o
 * maior número já visto é a memória da sequência. É por isso que reativar a v1
 * quando existem v1..v3 ainda produz v4 — reativar não devolve um número ao
 * estoque (item 18).
 */
export function nextVersionNumber(versions: readonly Pick<DocumentVersion, "version">[]): number {
  return versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

/** Da mais nova para a mais antiga — a ordem em que o histórico é lido. */
export function compareVersionsDesc(a: DocumentVersion, b: DocumentVersion): number {
  return b.version - a.version;
}

/**
 * A versão que representa a normativa na grid.
 *
 * A ativa, quando existe. Quando não existe — estado válido (RN25) —, a mais
 * recente, para a linha mostrar o que já foi publicado em vez de um traço.
 */
export function currentVersion(versions: readonly DocumentVersion[]): DocumentVersion | null {
  const active = versions.find((v) => v.status === "active");
  if (active) return active;

  return versions.reduce<DocumentVersion | null>(
    (latest, v) => (latest === null || v.version > latest.version ? v : latest),
    null,
  );
}

/**
 * O status da normativa é o status da VERSÃO — e a pergunta é sempre a mesma:
 * existe uma versão ativa? Sem versão nenhuma, ou com todas inativas, a
 * resposta é "inativo", e é isso que o chatbot enxerga.
 */
export function documentStatus(versions: readonly DocumentVersion[]): DocumentVersionStatus {
  return versions.some((v) => v.status === "active") ? "active" : "inactive";
}

/** Busca parcial por nome + status. Vazio em ambos = passa tudo. */
export function matchesDocumentFilters(
  document: DocumentSummary,
  filters: DocumentFilters,
): boolean {
  if (filters.status !== "all" && document.status !== filters.status) return false;

  const query = normalizeForSearch(filters.query);
  if (!query) return true;

  return normalizeForSearch(document.name).includes(query);
}

/** Ordem alfabética pelo nome, com as regras do português. */
export function compareDocuments(a: DocumentSummary, b: DocumentSummary): number {
  return a.name.localeCompare(b.name, "pt-BR");
}
