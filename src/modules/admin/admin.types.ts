import type { Database } from "@/types/database";
import type { Role } from "@/lib/rbac/rbac.types";

/**
 * Tipos do domínio Administração — Usuários e Configurações.
 *
 * ⚠️ NÃO EXISTE "MÓDULO DE ADMINISTRAÇÃO" NO BANCO, e isso é proposital. As
 * telas daqui operam sobre tabelas que já pertencem a outros módulos
 * (`profiles`, `event_segments`, `notification_opt_outs`) mais duas próprias
 * (`app_settings`, `consent_texts`). Administração é um RECORTE de tela, não
 * uma entidade — inventar tabelas espelho aqui criaria uma segunda verdade
 * sobre quem tem qual papel.
 */

export type AdminAuditAction = Database["public"]["Enums"]["admin_audit_action"];

/** Uma pessoa com acesso ao CRM. */
export interface AdminUser {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  createdAt: string;
  /**
   * É o usuário que está olhando a tela.
   *
   * ⚠️ Vem do servidor e não é calculado no cliente: é o que esconde o seletor
   * de papel da própria linha. Ninguém troca o próprio papel (o banco recusa
   * com AD002), e mostrar um seletor que só sabe dar erro é pior que não
   * mostrar nada.
   */
  isSelf: boolean;
}

/** Um público-alvo do catálogo, como a tela de configuração o edita. */
export interface AdminSegment {
  id: string;
  /** Imutável. Aparece na tela como informação, nunca como campo. */
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
  /** Quantos eventos já apontam para ele — o custo de desativá-lo. */
  eventCount: number;
}

/** Uma linha da lista de bloqueios de notificação. */
export interface NotificationBlock {
  id: string;
  phoneKey: string | null;
  source: string;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedNote: string | null;
  /** O associado dono do telefone, quando há um. */
  memberId: string | null;
  memberName: string | null;
  /** O nome no chatbot, quando a pessoa falou por lá. */
  contactName: string | null;
}

export interface NotificationBlockPage {
  rows: NotificationBlock[];
  total: number;
  page: number;
  pageSize: number;
}

/** Uma versão publicada do texto de consentimento. */
export interface ConsentText {
  version: string;
  body: string;
  createdAt: string;
  /** A versão vigente é a mais recente — não há coluna de "ativa". */
  isCurrent: boolean;
}

/**
 * O estado da integração de WhatsApp.
 *
 * ⚠️ TUDO AQUI É DIAGNÓSTICO, NADA É CONFIGURÁVEL. As credenciais da Z-API
 * moram em variável de ambiente e continuam lá: uma caixa de texto para colar o
 * token no banco transformaria uma tabela comum na coisa mais sensível do
 * sistema. Esta tela responde "está no ar?", e a resposta vem de fatos —
 * a última mensagem que entrou, a última que saiu.
 */
export interface WhatsAppIntegrationStatus {
  /** Nome do adaptador ativo (`z_api`, `unconfigured`...). */
  provider: string;
  configured: boolean;
  /** Quais variáveis de ambiente faltam. Só o NOME delas, nunca o valor. */
  missing: readonly string[];
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** Mensagens que saíram e falharam nas últimas 24 h. */
  failedLast24h: number;
  /** Bloqueios de notificação valendo agora. */
  activeBlocks: number;
}

export interface AdminAuditEntry {
  id: string;
  action: AdminAuditAction;
  target: string | null;
  actorName: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}
