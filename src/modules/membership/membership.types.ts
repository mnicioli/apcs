import type { Database } from "@/types/database";

/**
 * Tipos do domínio Associados.
 *
 * Os enums vêm do banco (via `pnpm db:types`), e não de literais escritos aqui:
 * é o que faz um valor novo no Postgres virar erro de compilação no TypeScript
 * em vez de um `default:` silencioso numa tela.
 */

export type MembershipProfileType = Database["public"]["Enums"]["membership_profile_type"];
export type MembershipApplicationStatus =
  Database["public"]["Enums"]["membership_application_status"];
export type MemberStatus = Database["public"]["Enums"]["member_status"];
export type MemberOrigin = Database["public"]["Enums"]["member_origin"];
export type MembershipAuditAction = Database["public"]["Enums"]["membership_audit_action"];

/**
 * As LISTAS, para `z.enum` e para ordenar filtros.
 *
 * ⚠️ Os TIPOS acima vêm do banco; estas listas existem porque `z.enum` precisa
 * de uma tupla literal, que um tipo não fornece. O `satisfies` impede as duas de
 * divergirem numa direção: um valor inventado aqui não compila. A outra direção
 * — um valor novo no Postgres que ninguém trouxe para cá — é pega pelos
 * `Record<...>` de membership.labels.ts, que ficam incompletos.
 */
/**
 * ⚠️ A ORDEM É A DOS ASSOCIADOS PRIMEIRO, e ela aparece na tela.
 *
 * Criador, Empresa e Técnico são os três tipos de ASSOCIADO; Universidade é o
 * único perfil que não é. Não há coluna dizendo isso — "ser associado" é uma
 * leitura do perfil (ver `isAssociateProfile`), porque uma coluna separada
 * poderia contradizer o perfil e duas verdades sobre o mesmo fato foi
 * exatamente o que a unificação veio acabar.
 */
export const MEMBERSHIP_PROFILE_TYPES = [
  "criador",
  "empresa",
  "tecnico",
  "universidade",
  /**
   * O público de TESTE da APCS — gente de casa, para experimentar uma
   * comunicação antes de mandá-la para a base.
   *
   * ⚠️ ELE É UM PERFIL, E NÃO UMA LISTA DE PESSOAS ESCOLHIDAS. Pertencer a um
   * público neste CRM É ter aquele perfil (`profile_for_event_segment`), e a
   * regra é uma só para eventos, disparos e enquetes. Uma lista avulsa seria
   * uma segunda forma de responder "quem está neste público", e as duas
   * divergiriam na primeira vez que alguém mexesse numa delas.
   */
  "interno",
] as const satisfies readonly MembershipProfileType[];

/**
 * Os três perfis que são associados.
 *
 * ⚠️ UNIVERSIDADE E TIME INTERNO FICAM DE FORA, e por motivos diferentes: a
 * universidade é uma instituição com quem a APCS fala sem que ela seja sócia; o
 * time interno é a própria APCS. Nenhum dos dois deve contar em número de
 * associados nem aparecer em indicador de base.
 */
export const ASSOCIATE_PROFILE_TYPES = [
  "criador",
  "empresa",
  "tecnico",
] as const satisfies readonly MembershipProfileType[];

/**
 * Os perfis que alguém pode declarar SOBRE SI no formulário público.
 *
 * ============================================================================
 * ⚠️ ESTA LISTA EXISTE PARA SER MENOR QUE `MEMBERSHIP_PROFILE_TYPES`.
 * ============================================================================
 *
 * `membershipApplicationSchema` valida o cadastro que chega de `/associe-se`,
 * que é a única porta ABERTA do sistema. Se ela validasse contra a lista
 * completa, qualquer pessoa poderia mandar `profileType: "interno"` direto para
 * a API e entrar no público de testes da APCS — recebendo, a partir daí, tudo
 * o que for disparado para ele.
 *
 * A tela pública nunca ofereceu esse botão (`PROFILE_TYPE_OPTIONS` tem quatro
 * itens), mas tela não é barreira: o corpo do POST é escolhido por quem chama.
 *
 * "Time Interno" só se atribui por dentro, no cadastro do associado, por quem
 * tem permissão de escrita em Associados.
 */
export const PUBLIC_PROFILE_TYPES = [
  "criador",
  "empresa",
  "tecnico",
  "universidade",
] as const satisfies readonly MembershipProfileType[];

/**
 * O tipo do que o formulário público aceita.
 *
 * ⚠️ ELE EXISTE PARA O TYPESCRIPT COBRAR A ESTREITEZA, e não por elegância. Sem
 * ele, o formulário continuaria tipado como `MembershipProfileType` — a união
 * completa — e um `setField("profileType", "interno")` compilaria sem
 * reclamação, deixando a barreira inteiramente por conta do Zod em tempo de
 * execução. Foi assim que o type-check encontrou os dois pontos do caminho
 * público no dia em que "interno" entrou no enum.
 */
export type PublicProfileType = (typeof PUBLIC_PROFILE_TYPES)[number];

/**
 * "Esta pessoa é associada?" — a pergunta que antes não tinha onde ser feita.
 *
 * Função e não `includes` solto na tela: quando um quinto perfil entrar, é
 * aqui que se decide de que lado ele cai, e não em cada arquivo que perguntou.
 */
export function isAssociateProfile(profile: MembershipProfileType | null): boolean {
  return profile !== null && (ASSOCIATE_PROFILE_TYPES as readonly string[]).includes(profile);
}

export const MEMBERSHIP_APPLICATION_STATUSES = [
  "pending",
  "in_review",
  "approved",
  "rejected",
] as const satisfies readonly MembershipApplicationStatus[];

export const MEMBER_STATUSES = [
  "active",
  "inactive",
  "suspended",
] as const satisfies readonly MemberStatus[];

/**
 * A única situação de onde não se sai. Serve à LEITURA (esconder botões que
 * levariam a um erro); quem autoriza a transição continua sendo o banco.
 */
export const TERMINAL_APPLICATION_STATUSES: readonly MembershipApplicationStatus[] = ["approved"];

/**
 * Por que se ordena o registro de associados.
 *
 * ⚠️ SÃO DOIS CRITÉRIOS, e não um cabeçalho clicável em cada coluna. A lista se
 * lê de duas maneiras: PROCURANDO uma pessoa pelo nome ("cadê o Valdomiro?") e
 * VENDO QUEM ENTROU POR ÚLTIMO. Cidade, perfil e origem não se ordenam — se
 * recortam, e para isso já existem as abas e a busca.
 *
 * ⚠️ LISTA FECHADA. O valor vem da URL e vira nome de COLUNA lá no service; sem
 * a lista, um `?sort=` com qualquer texto chegaria ao Postgres.
 */
export const MEMBER_SORT_FIELDS = ["name", "joinedAt"] as const;

export type MemberSortField = (typeof MEMBER_SORT_FIELDS)[number];

export interface MemberSort {
  field: MemberSortField;
  ascending: boolean;
}

/**
 * O sentido NATURAL de cada critério.
 *
 * Nome sobe (A→Z, que é como se procura numa lista de gente); data desce (o mais
 * recente primeiro, que é como se olha para quem chegou). Trocar de critério
 * começa pelo sentido dele — ninguém clica em "Associado desde" querendo ver
 * 2019 no topo.
 */
export const MEMBER_SORT_DEFAULT_ASCENDING: Record<MemberSortField, boolean> = {
  name: true,
  joinedAt: false,
};

/**
 * ⚠️ O PADRÃO É NOME DE A A Z, e não "cadastrado por último".
 *
 * A lista vinha por data de criação decrescente — herança da caixa de entrada de
 * solicitações, onde o que chegou por último é mesmo o que importa. No REGISTRO
 * a pergunta é outra: quem abre a tela quase sempre está atrás de uma pessoa
 * específica, e a ordem alfabética diz para onde olhar. A cronológica não diz
 * nada: para saber se "Belli" vem antes ou depois de "Biazoto" seria preciso ler
 * a lista inteira.
 */
export const DEFAULT_MEMBER_SORT: MemberSort = { field: "name", ascending: true };

/** Linha da solicitação como a grid e o detalhe a consomem. */
export interface MembershipApplicationRow {
  id: string;
  protocol: string;
  status: MembershipApplicationStatus;
  profileType: MembershipProfileType;
  fullName: string;
  email: string;
  whatsapp: string;
  city: string;
  state: string;
  organization: string | null;
  createdAt: string;
  reviewedAt: string | null;
  memberId: string | null;
}

/** A solicitação inteira, para a tela de detalhe. */
export interface MembershipApplicationDetail extends MembershipApplicationRow {
  farmName: string | null;
  productionCity: string | null;
  sowCount: number | null;
  cnpj: string | null;
  stateRegistration: string | null;
  activityArea: string | null;
  jobTitle: string | null;
  legalName: string | null;
  tradeName: string | null;
  consentAt: string;
  consentPolicyVersion: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  member: MemberRow | null;
}

/** Linha do associado no registro. */
export interface MemberRow {
  id: string;
  code: string | null;
  status: MemberStatus;
  origin: MemberOrigin;
  profileType: MembershipProfileType | null;
  fullName: string;
  email: string | null;
  whatsapp: string | null;
  city: string | null;
  state: string | null;
  organization: string | null;
  joinedAt: string | null;
  createdAt: string;
  /**
   * Pediu para não receber notificações da APCS.
   *
   * ⚠️ NÃO É UMA COLUNA DE `members`, e não é preguiça: o bloqueio é do
   * TELEFONE, e dois associados podem compartilhar um (marido e mulher na mesma
   * granja, um número de escritório). Uma coluna criaria a possibilidade de os
   * dois discordarem sobre o mesmo aparelho.
   */
  optedOut: boolean;
}

/**
 * O cadastro INTEIRO do associado, para a ficha e o formulário de edição.
 *
 * ⚠️ `externalId` e `origin` aparecem aqui e NÃO são editáveis — ver a decisão 3
 * de 20260829140100_update_member.sql. Estão no tipo porque a ficha os mostra:
 * "veio da carga do cadastro anterior" é justamente o que explica por que um
 * registro antigo tem tanto campo vazio.
 */
export interface MemberDetail extends MemberRow {
  externalId: string | null;
  farmName: string | null;
  productionCity: string | null;
  sowCount: number | null;
  cnpj: string | null;
  stateRegistration: string | null;
  activityArea: string | null;
  jobTitle: string | null;
  legalName: string | null;
  tradeName: string | null;
  interests: string[];
  otherInterest: string | null;
  notes: string | null;
  updatedAt: string;
  /** Protocolo da solicitação que originou o associado, quando houve uma. */
  applicationProtocol: string | null;
  applicationId: string | null;
}

/**
 * O texto de consentimento vigente, como a landing pública o recebe.
 *
 * ⚠️ A VERSÃO ANDA JUNTO DO TEXTO, e é por isso que este tipo existe em vez de
 * uma `string`. A solicitação grava a versão que a pessoa LEU — separar os dois
 * abriria a porta para mostrar um texto e registrar autorização para outro.
 */
export interface ConsentSnapshot {
  version: string;
  body: string;
}

/** Contadores da caixa de entrada, por situação. */
export type MembershipApplicationCounts = Record<MembershipApplicationStatus, number>;
