import { normalizeForSearch } from "@/lib/utils";
import type { KnowledgeBlocker, KnowledgeEntry, KnowledgeFilters } from "./knowledge.types";

/**
 * As regras da Base de Conhecimento — puras, sem I/O, testáveis uma a uma.
 *
 * ⚠️ A DIVISÃO É A MESMA DE `document.rules.ts`, E ELA IMPORTA AQUI MAIS DO QUE
 * EM QUALQUER OUTRO MÓDULO:
 *
 *   O que é regra de NEGÓCIO — quais itens o chatbot pode usar — vive no BANCO,
 *   dentro de `search_knowledge()`. É lá que ela é IMPOSTA, e é lá que ela vale
 *   mesmo para quem chamar o PostgREST direto.
 *
 *   O que está aqui é a LEITURA dessa regra: o badge da grid, o aviso do
 *   formulário, a ordenação. `isAvailableToChatbot` espelha o `where` daquela
 *   função e existe para a tela poder explicar o estado sem ida ao banco.
 *
 * Espelhar é o risco conhecido: duas escritas da mesma regra podem divergir. A
 * troca foi consciente — a alternativa era a tela perguntar ao banco item por
 * item para desenhar uma lista. O teste `knowledge.rules.test.ts` fixa a tabela
 * de casos, e o `where` da migration está citado nele linha a linha.
 */

/** O "hoje" da APCS, no formato AAAA-MM-DD que as colunas `date` usam. */
export function apcsToday(now: Date = new Date()): string {
  // `en-CA` produz AAAA-MM-DD, que é exatamente o formato de uma coluna `date`.
  // Fazer isso com `toISOString()` daria o dia em UTC — e das 21h à meia-noite
  // em São Paulo isso é o dia SEGUINTE, o que faria um item vigente até hoje
  // sumir três horas antes da hora.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

/**
 * O que impede este item de ser usado pelo chatbot agora — ou `null`.
 *
 * A ORDEM DA LISTA É A ORDEM DA CAUSA: quem vê "inativo" não precisa saber
 * que a vigência também expirou. Resolver o primeiro é o que a pessoa faz.
 */
export function knowledgeBlocker(
  entry: Pick<KnowledgeEntry, "status" | "availableForChatbot" | "startsAt" | "endsAt">,
  today: string = apcsToday(),
): KnowledgeBlocker | null {
  if (entry.status !== "active") return "inactive";
  if (!entry.availableForChatbot) return "notReleased";
  if (entry.startsAt && entry.startsAt > today) return "notStarted";
  if (entry.endsAt && entry.endsAt < today) return "expired";
  return null;
}

/**
 * §43 do escopo, na leitura da tela.
 *
 *     ATIVO + DISPONÍVEL PARA CHATBOT + DENTRO DA VIGÊNCIA = ELEGÍVEL
 *
 * A comparação de datas é feita como STRING de propósito: AAAA-MM-DD ordena
 * lexicograficamente igual a cronologicamente, e converter para `Date` só
 * introduziria fuso horário numa comparação que não tem hora.
 */
export function isAvailableToChatbot(
  entry: Pick<KnowledgeEntry, "status" | "availableForChatbot" | "startsAt" | "endsAt">,
  today: string = apcsToday(),
): boolean {
  return knowledgeBlocker(entry, today) === null;
}

/** Quantos itens o chatbot realmente alcança agora. É o número do topo da tela. */
export function countAvailableToChatbot(
  entries: readonly KnowledgeEntry[],
  today: string = apcsToday(),
): number {
  return entries.filter((e) => isAvailableToChatbot(e, today)).length;
}

/**
 * Busca da grid: título, conteúdo e palavras-chave, sem acento e sem caixa.
 *
 * As palavras-chave entram na busca porque é por elas que o bot encontra o
 * item — quem procura "horas" na tela está procurando o mesmo item que o
 * associado procura escrevendo "horas" no WhatsApp.
 */
export function matchesKnowledgeFilters(entry: KnowledgeEntry, filters: KnowledgeFilters): boolean {
  if (filters.status !== "all" && entry.status !== filters.status) return false;
  if (filters.categoryId && entry.categoryId !== filters.categoryId) return false;

  const query = normalizeForSearch(filters.query);
  if (!query) return true;

  const alvo = [entry.title, entry.content, ...entry.keywords]
    .map((parte) => normalizeForSearch(parte))
    .join(" ");

  return alvo.includes(query);
}

/** Ordem alfabética pelo título, com as regras do português. */
export function compareKnowledgeEntries(a: KnowledgeEntry, b: KnowledgeEntry): number {
  return a.title.localeCompare(b.title, "pt-BR");
}

/**
 * Palavras-chave a partir do que a pessoa digitou.
 *
 * ⚠️ VÍRGULA **E** QUEBRA DE LINHA, porque as duas acontecem: quem cola de uma
 * planilha traz uma por linha, e quem digita usa vírgula. Aceitar só uma delas
 * transformaria uma lista colada num único item gigante — que nunca casaria
 * com mensagem nenhuma, e o item ficaria invisível sem nenhum erro na tela.
 *
 * Duplicatas saem (sem acento e sem caixa, "Horário" e "horario" são a mesma
 * chave de busca) e a ORDEM DA PRIMEIRA APARIÇÃO é preservada — a pessoa
 * reconhece a própria lista quando reabre o formulário.
 */
export function parseKeywords(input: string): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];

  for (const bruta of input.split(/[,\n;]/)) {
    const palavra = bruta.trim().replace(/\s+/g, " ");
    if (!palavra) continue;

    const chave = normalizeForSearch(palavra);
    if (vistas.has(chave)) continue;

    vistas.add(chave);
    saida.push(palavra);
  }

  return saida;
}

/** O caminho de volta: a lista como o formulário a exibe. */
export function formatKeywords(keywords: readonly string[]): string {
  return keywords.join(", ");
}
