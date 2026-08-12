import {
  BookOpen,
  Brain,
  Contact,
  FileText,
  Inbox,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  MessagesSquare,
  ScrollText,
  Settings,
  Ticket,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/rbac/rbac.types";

export interface NavItem {
  /** Rótulo exibido na UI (PT-BR). */
  title: string;
  /** Rota (em inglês, kebab-case). */
  href: string;
  icon: LucideIcon;
  /** Permissão necessária para ver o item. Ausente = visível para todos os logados. */
  permission?: Permission;
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
