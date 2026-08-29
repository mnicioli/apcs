import type { AdminAuditAction } from "./admin.types";

/**
 * Rótulos PT-BR da Administração. Todo texto que a pessoa lê sai daqui.
 */

export const USERS_TITLE = "Usuários";
export const USERS_SUBTITLE = "Quem tem acesso ao sistema e o que cada um pode fazer.";

export const SETTINGS_TITLE = "Configurações";
export const SETTINGS_SUBTITLE = "O que a plataforma usa para se comunicar e se organizar.";

export const ADMIN_AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  user_role_changed: "Papel alterado",
  user_invited: "Usuário convidado",
  segment_updated: "Público-alvo alterado",
  consent_text_published: "Texto de consentimento publicado",
  setting_updated: "Configuração alterada",
  notification_block_revoked: "Bloqueio de notificação desfeito",
  user_updated: "Cadastro de usuário editado",
  user_deactivated: "Conta inativada",
  user_reactivated: "Conta reativada",
  user_password_reset: "Recuperação de senha enviada",
};

/**
 * O que cada papel PODE, em uma frase.
 *
 * Existe porque "Gestor" e "Comercial" não dizem nada a quem está escolhendo, e
 * a consequência de errar é concreta: dar acesso de escrita a quem devia só
 * consultar, ou o contrário — e descobrir semanas depois, quando alguém não
 * conseguiu fazer o próprio trabalho.
 *
 * ⚠️ Estas frases descrevem a matriz de `rbac.config.ts`. Ao mexer lá, mexa
 * aqui: uma descrição desatualizada é pior que nenhuma, porque é acreditada.
 */
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Faz tudo: publica, aprova, divulga, e gerencia usuários e configurações.",
  comercial: "Atende no WhatsApp e consulta os cadastros. Não publica nem aprova.",
  // ⚠️ A frase diz a verdade incômoda: com Clientes, Projetos e Financeiro
  // fora do ar, este papel hoje não abre tela nenhuma. Escrever "Financeiro e
  // rentabilidade" faria quem convida achar que está dando um acesso que não
  // existe — e a pessoa convidada descobriria sozinha, entrando num sistema
  // vazio.
  financeiro: "Reservado para quando o módulo Financeiro existir. Hoje não abre nenhuma tela.",
  viewer: "Entra no sistema e não vê quase nada. É como todo usuário novo nasce.",
};

/* -------------------------------------------------------------------------- */
/* Chaves de configuração                                                     */
/* -------------------------------------------------------------------------- */

/**
 * As chaves de `app_settings` que a tela conhece.
 *
 * ⚠️ LISTA FECHADA, e não um editor de chave livre. Um campo "chave" aberto
 * deixaria alguém criar `whatsapp.optout_confirmed` (sem o underscore certo) e
 * passar semanas achando que editou a mensagem que sai — enquanto o código
 * continua lendo a chave antiga. O CHECK do banco valida o FORMATO; esta lista
 * valida o SIGNIFICADO.
 */
export const SETTING_KEYS = {
  optOutConfirmed: "whatsapp.opt_out_confirmed",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const SETTING_LABELS: Record<SettingKey, { title: string; help: string }> = {
  [SETTING_KEYS.optOutConfirmed]: {
    title: "Confirmação de saída",
    help: "A resposta automática de quem manda SAIR. É a ÚLTIMA mensagem que essa pessoa recebe — sem ela, ninguém sabe se funcionou, e a saída restante seria bloquear o número da APCS.",
  },
};

/* -------------------------------------------------------------------------- */
/* Abas de Configurações                                                      */
/* -------------------------------------------------------------------------- */

export const SETTINGS_TABS = [
  { href: "/settings", label: "Integração" },
  { href: "/settings/segments", label: "Públicos-alvo" },
  { href: "/settings/notifications", label: "Bloqueios" },
  { href: "/settings/texts", label: "Textos e LGPD" },
] as const;
