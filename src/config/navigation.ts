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
  MessagesSquare,
  Presentation,
  ScrollText,
  Settings,
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
export type NavBadge = "lecturesPending" | "membershipPending";

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
}

export interface NavSection {
  title: string;
  items: NavItem[];
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
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, available: true }],
  },
  {
    title: "Atendimento",
    items: [
      {
        title: "Leads do CSP",
        href: "/leads",
        icon: Contact,
        permission: "leads.read",
        available: true,
      },
      {
        title: "Central de Atendimento",
        href: "/attendances",
        icon: Inbox,
        permission: "attendances.read",
        available: true,
      },
      {
        title: "Conversas",
        href: "/conversations",
        icon: MessagesSquare,
        permission: "leads.read",
        available: false,
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
        title: "Base de Conhecimento",
        href: "/knowledge",
        icon: BookOpen,
        permission: "analytics.read",
        available: false,
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
    title: "Administração",
    items: [
      {
        title: "Usuários",
        href: "/users",
        icon: Users,
        permission: "users.manage",
        available: false,
      },
      {
        title: "Configurações",
        href: "/settings",
        icon: Settings,
        permission: "settings.manage",
        available: false,
      },
    ],
  },
];
