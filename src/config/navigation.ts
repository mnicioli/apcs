import {
  BarChart3,
  BookOpen,
  Brain,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Contact,
  FileText,
  Inbox,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Presentation,
  ScrollText,
  Settings,
  ShieldCheck,
  Ticket,
  Timer,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/rbac/rbac.types";

/**
 * Contadores que a navegação sabe exibir.
 *
 * Chave, e não número: a navegação é CONFIGURAÇÃO, e configuração não busca
 * dado. Quem apura o número é o layout (que é servidor) e o passa para a
 * Sidebar — assim um contador novo entra sem transformar este arquivo num
 * ponto de acesso ao banco.
 */
export type NavBadge = "lecturesPending" | "membershipPending" | "whatsappUnread";

export interface NavItem {
  /** Rótulo exibido na UI (PT-BR). */
  title: string;
  /** Rota (em inglês, kebab-case). */
  href: string;
  icon: LucideIcon;
  /** Permissão necessária para ver o item. Ausente = visível para todos os logados. */
  permission?: Permission;
  /** Contador exibido à direita do item, quando maior que zero. */
  badge?: NavBadge;
  /**
   * `false` = item de roadmap, ainda não implementado. Aparece com selo
   * "Em breve" e leva a um placeholder. Ao implementar o módulo, vire `true`.
   */
  available: boolean;
  /**
   * `true` = some do menu.
   *
   * ⚠️ É DIFERENTE DE `available: false`, e a diferença importa. Aquele diz
   * "ainda não construímos" e mostra o item apagado com o selo "Em breve" — uma
   * promessa visível. Este diz "não queremos isto no menu agora": o item
   * desaparece, sem deixar rastro na navegação.
   *
   * ⚠️ SUMIR DO MENU NÃO É TIRAR DO AR. A rota continua de pé e quem tiver o
   * endereço entra — as permissões do módulo é que continuam decidindo. Se a
   * intenção for BLOQUEAR o acesso, o lugar é `rbac.config.ts` mais a RLS da
   * tabela, não esta linha.
   *
   * ⚠️ ESCONDER É PREFERÍVEL A APAGAR quando o módulo existe e funciona. Apagar
   * a entrada joga fora o ícone, a rota e a permissão certos — e trazer de
   * volta vira arqueologia no histórico do Git.
   */
  hidden?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  /**
   * A seção começa ABERTA.
   *
   * ⚠️ SÓ VALE PARA O PRIMEIRO ACESSO. Depois disso vale o que a pessoa
   * deixou — a Sidebar guarda no navegador, e a seção da tela em que se está
   * abre sozinha. Um padrão que se reimpusesse a cada navegação fecharia o
   * menu na cara de quem acabou de abri-lo.
   *
   * Atendimento é a única aberta por decisão: é a tela que fica no ar o dia
   * inteiro. O resto se consulta de vez em quando, e nove seções abertas
   * fazem o menu passar da altura da janela — o que esconde as últimas sem
   * que ninguém tenha escolhido esconder.
   */
  defaultOpen?: boolean;
}

/**
 * O item aparece no menu para quem tem estas permissões?
 *
 * ⚠️ FUNÇÃO PURA, E FORA DA SIDEBAR DE PROPÓSITO. A regra tem duas metades que
 * se parecem e não são a mesma coisa — "escondido" (decisão de menu) e "sem
 * permissão" (decisão de acesso) —, e é o tipo de condição que alguém
 * simplifica sem perceber que trocou uma pela outra. Aqui ela é testável sem
 * renderizar nada.
 *
 * A ordem importa: `hidden` decide primeiro. Um item escondido não chega a ser
 * consultado contra a matriz de permissões.
 */
export function isNavItemVisible(item: NavItem, can: (permission: Permission) => boolean): boolean {
  if (item.hidden) return false;
  return !item.permission || can(item.permission);
}

/**
 * Navegação principal. Espelha o roadmap da Plataforma de Atendimento
 * Inteligente APCS (ver docs/ROADMAP.md). Conforme cada módulo for construído,
 * marque `available: true` — a navegação é a fonte da verdade da estrutura do
 * produto.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Geral",
    defaultOpen: true,
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, available: true }],
  },
  {
    title: "Atendimento",
    defaultOpen: true,
    items: [
      {
        title: "Leads do CSP",
        href: "/leads",
        icon: Contact,
        permission: "leads.read",
        available: true,
      },
      {
        // ⚠️ PRIMEIRO ITEM DA SEÇÃO, e de propósito: é a tela que fica aberta o
        // dia inteiro. O contador de não lidas mora aqui porque é a única
        // pergunta que o time faz sem parar — "tem alguém esperando?".
        title: "WhatsApp",
        href: "/whatsapp",
        icon: MessageCircle,
        permission: "whatsapp.read",
        badge: "whatsappUnread",
        available: true,
      },
      {
        // Escondida a pedido. O módulo CONTINUA INTEIRO — telas, actions, RLS e
        // testes — e a rota `/attendances` responde para quem tiver o endereço.
        // Voltar ao menu é apagar a linha `hidden` abaixo.
        title: "Central de Atendimento",
        href: "/attendances",
        icon: Inbox,
        permission: "attendances.read",
        available: true,
        hidden: true,
      },
      {
        // Escondida a pedido. Esta nunca chegou a existir (`available: false`,
        // ou seja, aparecia só como "Em breve") — some sem consequência nenhuma.
        title: "Conversas",
        href: "/conversations",
        icon: MessagesSquare,
        permission: "leads.read",
        available: false,
        hidden: true,
      },
      {
        title: "Tickets",
        href: "/tickets",
        icon: Ticket,
        permission: "leads.read",
        available: false,
      },
      {
        title: "Filas",
        href: "/queues",
        icon: ListOrdered,
        permission: "leads.write",
        available: false,
      },
      {
        title: "SLA",
        href: "/sla",
        icon: Timer,
        permission: "leads.write",
        available: false,
      },
    ],
  },
  {
    title: "Documentos",
    items: [
      {
        title: "Normativas",
        href: "/documents/normatives",
        icon: ScrollText,
        permission: "documents.read",
        available: true,
      },
      {
        title: "Comunicação",
        href: "/documents/communication",
        icon: Megaphone,
        permission: "documents.read",
        available: true,
      },
      {
        // Fica sob Documentos porque é onde as pessoas procuram, mas NÃO é uma
        // categoria de `documents` — é módulo próprio, com rota própria. O
        // agrupamento aqui é de navegação, não de dados. Ver docs/BOLSA.md §3.
        title: "Bolsa",
        href: "/market",
        icon: TrendingUp,
        permission: "market.read",
        available: true,
      },
    ],
  },
  {
    // Seção própria, e não um item dentro de outra: Evento é menu principal do
    // CRM (RN01). Nasce com um item só — quando a comunicação segmentada
    // chegar, ela entra aqui ao lado, sem remexer na navegação.
    title: "Eventos",
    items: [
      {
        title: "Eventos",
        href: "/events",
        icon: CalendarDays,
        permission: "events.read",
        available: true,
      },
    ],
  },
  {
    // Seção própria, como Eventos: Palestras é menu principal do CRM, e nasce
    // com os dois itens que o escopo desenha. O Calendário vem PRIMEIRO porque
    // é a pergunta que o time faz todo dia ("o que tem marcado?"); a lista
    // completa é para quando alguém procura algo específico.
    title: "Palestras",
    items: [
      {
        title: "Calendário",
        href: "/lectures/calendar",
        icon: CalendarClock,
        permission: "lectures.read",
        available: true,
      },
      {
        title: "Palestras",
        href: "/lectures",
        icon: Presentation,
        permission: "lectures.read",
        // O contador de solicitações pendentes aparece aqui, e não no
        // Calendário: uma solicitação nova ainda NÃO tem data marcada, então
        // ela não está no calendário — está esperando na lista.
        badge: "lecturesPending",
        available: true,
      },
    ],
  },
  {
    // §2. Seção própria, como Eventos e Palestras: Enquetes é menu principal do
    // CRM, e nasce com os dois itens que o escopo desenha. A estrutura comporta
    // evolução — um "Disparos" entra aqui ao lado no dia em que o envio existir.
    //
    title: "Enquetes",
    items: [
      {
        title: "Enquetes",
        href: "/surveys",
        icon: ClipboardList,
        permission: "surveys.read",
        available: true,
      },
      {
        title: "Resultados",
        href: "/surveys/results",
        icon: BarChart3,
        permission: "surveys.read",
        available: true,
      },
    ],
  },
  {
    // Seção própria, como Eventos, Palestras e Enquetes. As SOLICITAÇÕES vêm
    // primeiro porque são a pergunta do dia ("chegou alguém novo?"); o registro
    // é para quando se procura uma pessoa específica.
    //
    // ⚠️ O contador fica nas Solicitações, e conta AGUARDANDO + EM ANÁLISE: as
    // duas são trabalho em aberto. Um contador que zerasse ao alguém "assumir"
    // faria a fila parecer vazia com solicitação parada há uma semana.
    title: "Associados",
    items: [
      {
        title: "Solicitações",
        href: "/members/applications",
        icon: UserPlus,
        permission: "members.read",
        badge: "membershipPending",
        available: true,
      },
      {
        title: "Associados",
        href: "/members",
        icon: Users,
        permission: "members.read",
        available: true,
      },
    ],
  },
  {
    title: "Inteligência",
    items: [
      {
        // ⚠️ PERMISSÃO PRÓPRIA, e não mais `analytics.read`. Enquanto era item
        // de roadmap, a chave analítica servia de espaço reservado; agora que a
        // tela existe, quem a abre é quem cuida do que o chatbot responde — que
        // não é a mesma pessoa que lê indicadores. Ver `knowledge.read` em
        // rbac.config.ts e a RLS de `knowledge_entries`.
        title: "Base de Conhecimento",
        href: "/knowledge",
        icon: BookOpen,
        permission: "knowledge.read",
        available: true,
      },
      {
        title: "Prompts",
        href: "/ai/prompts",
        icon: Brain,
        permission: "analytics.read",
        available: false,
      },
      {
        title: "Analytics",
        href: "/analytics",
        icon: LineChart,
        permission: "analytics.read",
        available: false,
      },
      {
        title: "Relatórios",
        href: "/reports",
        icon: FileText,
        permission: "analytics.read",
        available: false,
      },
    ],
  },
  {
    // ⚠️ A ÚNICA SEÇÃO SÓ DE ADMINISTRADOR. Todas as outras abrem para Gestor e,
    // em leitura, para Atendente — aqui não: um Gestor decide sobre associados,
    // eventos e enquetes, mas quem decide QUEM DECIDE é outra coisa.
    title: "Administração",
    items: [
      {
        title: "Usuários",
        href: "/users",
        icon: Users,
        permission: "users.manage",
        available: true,
      },
      {
        title: "Matriz de Acesso",
        href: "/permissions",
        icon: ShieldCheck,
        // Mesma permissão de Usuários, e não `settings.manage`: a matriz
        // responde "quem pode o quê", que é a pergunta de quem administra
        // pessoas — não a de quem mexe em textos e integrações.
        permission: "users.manage",
        available: true,
      },
      {
        title: "Configurações",
        href: "/settings",
        icon: Settings,
        permission: "settings.manage",
        available: true,
      },
    ],
  },
];
