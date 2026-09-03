import type { Permission } from "./rbac.types";

/**
 * A MATRIZ DE ACESSO EM PORTUGUÊS — o que cada permissão significa para quem
 * não lê `rbac.config.ts`.
 *
 * `PERMISSION_MATRIX` diz QUEM tem cada chave. Este arquivo diz O QUE a chave
 * permite, e a que módulo ela pertence. Os dois juntos viram a tela
 * `/permissions`, que responde "o que um Gestor pode fazer?" sem ninguém
 * precisar abrir o código.
 *
 * ⚠️ NÃO É UMA SEGUNDA VERDADE. Nenhuma decisão de acesso é tomada aqui — este
 * arquivo só nomeia. Quem decide continua sendo `PERMISSION_MATRIX` (1ª camada)
 * e a RLS do banco (2ª). Se um dia alguém tentar usar algo daqui num `if`, está
 * usando a legenda no lugar do mapa.
 *
 * ⚠️ TODA PERMISSÃO PRECISA APARECER EM EXATAMENTE UM GRUPO. É o que o teste
 * `rbac.labels.test.ts` garante — e é o que impede a tela de mentir por
 * omissão: uma permissão nova sem grupo simplesmente não apareceria na matriz,
 * e a ausência de uma linha não chama atenção de ninguém.
 */

export type PermissionGroupStatus =
  /** O módulo está no ar; a permissão vale hoje. */
  | "live"
  /** Declarado no roadmap, tela ainda não existe. */
  | "roadmap"
  /**
   * Herdado do modelo genérico em que este sistema nasceu (o "FAST Operation
   * Cockpit"). Nenhuma tela do APCS usa. Aparece na matriz em vez de sumir
   * porque as chaves ESTÃO no código, e uma matriz que esconde parte do que
   * existe é pior que uma matriz com uma seção esquisita.
   */
  | "unused";

export interface PermissionGroup {
  title: string;
  status: PermissionGroupStatus;
  permissions: readonly Permission[];
}

/** O que cada chave libera, dito como quem explica para uma pessoa. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "leads.read": "Ver os leads gerados pelo chat",
  "leads.write": "Editar e encaminhar leads",

  "attendances.read": "Abrir a fila de atendimentos do chat",
  "attendances.write": "Assumir e concluir atendimentos",

  "whatsapp.read": "Ler as conversas de WhatsApp",
  "whatsapp.write": "Responder e arquivar conversas",

  "documents.read": "Consultar e baixar normativas",
  "documents.write": "Publicar versões e mudar o status",

  "market.read": "Consultar e baixar boletins da Bolsa",
  "market.write": "Publicar versões do boletim",

  "events.read": "Ver a agenda de eventos",
  "events.write": "Criar, editar e divulgar eventos",

  "lectures.read": "Ver as palestras e o calendário",
  "lectures.write": "Agendar, atribuir e decidir status",

  "surveys.read": "Ver as enquetes e os resultados",
  "surveys.write": "Criar, disparar e encerrar enquetes",

  "members.read": "Ver associados e solicitações",
  "members.write": "Aprovar, recusar e editar cadastros",

  "knowledge.read": "Consultar as respostas do chatbot",
  "knowledge.write": "Escrever o que o chatbot responde",

  "flows.read": "Consultar os fluxos de atendimento",
  "flows.write": "Desenhar, aprovar e publicar fluxos",

  "analytics.read": "Abrir relatórios e indicadores",

  "users.manage": "Convidar, editar papéis e inativar contas",
  "settings.manage": "Mudar configurações e textos do sistema",

  "clients.read": "Ver clientes",
  "clients.write": "Editar clientes",
  "projects.read": "Ver projetos",
  "projects.write": "Editar projetos",
  "resources.read": "Ver recursos",
  "resources.write": "Editar recursos",
  "allocation.read": "Ver alocações",
  "allocation.write": "Editar alocações",
  "finance.read": "Ver o financeiro",
  "finance.write": "Lançar no financeiro",
  "infrastructure.read": "Ver infraestrutura",
  "infrastructure.write": "Editar infraestrutura",
};

/**
 * A ORDEM É A DO MENU, de propósito. Quem procura "o que o Atendente vê em
 * Eventos" percorre a matriz com a navegação na cabeça — uma ordem alfabética
 * ou a ordem em que as chaves foram escritas obrigaria a caçar.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    title: "Atendimento",
    status: "live",
    permissions: ["leads.read", "leads.write", "attendances.read", "attendances.write"],
  },
  { title: "WhatsApp", status: "live", permissions: ["whatsapp.read", "whatsapp.write"] },
  { title: "Documentos", status: "live", permissions: ["documents.read", "documents.write"] },
  { title: "Bolsa", status: "live", permissions: ["market.read", "market.write"] },
  { title: "Eventos", status: "live", permissions: ["events.read", "events.write"] },
  { title: "Palestras", status: "live", permissions: ["lectures.read", "lectures.write"] },
  { title: "Enquetes", status: "live", permissions: ["surveys.read", "surveys.write"] },
  { title: "Associados", status: "live", permissions: ["members.read", "members.write"] },
  // Grupo próprio, e não uma linha dentro de "Inteligência" abaixo: aquele
  // continua sendo roadmap (Analytics, Relatórios), e este JÁ EXISTE. Misturar
  // os dois faria a matriz oferecer uma caixa em construção ao lado de uma que
  // abre uma tela de verdade, com o mesmo aspecto.
  {
    title: "Base de Conhecimento",
    status: "live",
    permissions: ["knowledge.read", "knowledge.write"],
  },
  {
    title: "Fluxos de Atendimento",
    status: "live",
    permissions: ["flows.read", "flows.write"],
  },
  { title: "Administração", status: "live", permissions: ["users.manage", "settings.manage"] },
  { title: "Inteligência", status: "roadmap", permissions: ["analytics.read"] },
  {
    title: "Módulos do modelo original",
    status: "unused",
    permissions: [
      "clients.read",
      "clients.write",
      "projects.read",
      "projects.write",
      "resources.read",
      "resources.write",
      "allocation.read",
      "allocation.write",
      "finance.read",
      "finance.write",
      "infrastructure.read",
      "infrastructure.write",
    ],
  },
];

export const PERMISSION_GROUP_NOTES: Record<PermissionGroupStatus, string | null> = {
  live: null,
  roadmap: "A tela ainda não existe. O acesso já está decidido para quando existir.",
  unused:
    "Chaves que vieram do modelo genérico em que o sistema nasceu. Nenhuma tela do APCS as consulta — " +
    "estão aqui para a matriz não esconder nada.",
};

/**
 * Todas as permissões, na ordem da matriz.
 *
 * ⚠️ DERIVADA DOS GRUPOS, e não uma lista à parte. `rbac.labels.test.ts` prova
 * que os grupos cobrem cada permissão exatamente uma vez — então esta lista
 * está sempre completa, e uma permissão nova entra aqui pelo mesmo caminho por
 * onde entra na tela. Uma segunda lista escrita à mão envelheceria em silêncio,
 * e o sintoma seria um cargo que não consegue receber a permissão nova.
 */
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap(
  (grupo) => grupo.permissions,
);
