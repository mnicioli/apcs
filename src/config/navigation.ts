import {
  Boxes,
  Brain,
  Building2,
  CalendarRange,
  Cloud,
  DollarSign,
  FolderKanban,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  LineChart,
  Settings,
  TrendingUp,
  Users,
  UsersRound,
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
 * Navegação principal. Os 13 módulos do escopo (ver docs/ROADMAP.md) já
 * aparecem aqui como roadmap (`available: false`). Conforme cada módulo for
 * construído, marque `available: true` — a navegação é a fonte da verdade da
 * estrutura do produto.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Geral",
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, available: true }],
  },
  {
    title: "Operação",
    items: [
      {
        title: "Clientes",
        href: "/clients",
        icon: Building2,
        permission: "clients.read",
        available: false,
      },
      {
        title: "Projetos",
        href: "/projects",
        icon: FolderKanban,
        permission: "projects.read",
        available: false,
      },
      {
        title: "Recursos",
        href: "/resources",
        icon: UsersRound,
        permission: "resources.read",
        available: false,
      },
      {
        title: "Alocação",
        href: "/allocation",
        icon: CalendarRange,
        permission: "allocation.read",
        available: false,
      },
      {
        title: "Infraestrutura",
        href: "/infrastructure",
        icon: Cloud,
        permission: "infrastructure.read",
        available: false,
      },
    ],
  },
  {
    title: "Financeiro",
    items: [
      {
        title: "Financeiro",
        href: "/finance",
        icon: DollarSign,
        permission: "finance.read",
        available: false,
      },
      {
        title: "Rentabilidade",
        href: "/profitability",
        icon: TrendingUp,
        permission: "finance.read",
        available: false,
      },
      {
        title: "Forecast",
        href: "/forecast",
        icon: LineChart,
        permission: "finance.read",
        available: false,
      },
    ],
  },
  {
    title: "Inteligência",
    items: [
      {
        title: "Health Score",
        href: "/health-score",
        icon: HeartPulse,
        permission: "analytics.read",
        available: false,
      },
      {
        title: "Capacity Planning",
        href: "/capacity",
        icon: Gauge,
        permission: "analytics.read",
        available: false,
      },
      {
        title: "Simulador Comercial",
        href: "/simulator",
        icon: Boxes,
        permission: "analytics.read",
        available: false,
      },
      {
        title: "IA Consultiva",
        href: "/ai-assistant",
        icon: Brain,
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
