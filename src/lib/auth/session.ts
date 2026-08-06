/**
 * Tipos e helpers de sessão (puros — sem acesso a banco, fáceis de testar).
 */

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

// Avatar vem de `user_metadata`, que o próprio usuário pode editar. Sem
// allowlist, qualquer URL HTTPS seria carregada — superfície para tracking
// pixel/leak de IP. Restringe aos hosts que de fato servem avatar.
const ALLOWED_AVATAR_HOSTS = ["supabase.co", "googleusercontent.com", "gravatar.com"] as const;

function isAllowedAvatarUrl(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return ALLOWED_AVATAR_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Linha de `profiles` — a fonte da verdade do nome e do avatar. */
export interface ProfileIdentity {
  full_name?: string | null;
  avatar_url?: string | null;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Monta o usuário da sessão a partir da conta de auth e do perfil.
 *
 * A ORDEM importa: `profiles` vem primeiro porque é onde `updateProfileAction`
 * grava. Lendo só de `user_metadata`, editar o nome em /profile não mudaria
 * nada no cabeçalho — o valor ficaria guardado num lugar que a UI não lê.
 * O metadata continua como fallback: em signup por OAuth ele chega preenchido
 * antes de o perfil existir. O e-mail é o último recurso.
 */
export function toSessionUser(
  user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  },
  profile?: ProfileIdentity | null,
): SessionUser {
  const metadata = user.user_metadata ?? {};
  const fullName = trimmed(profile?.full_name) || trimmed(metadata.full_name) || (user.email ?? "");

  const rawAvatar = trimmed(profile?.avatar_url) || trimmed(metadata.avatar_url);
  const avatarUrl = rawAvatar && isAllowedAvatarUrl(rawAvatar) ? rawAvatar : null;

  return {
    id: user.id,
    email: user.email ?? "",
    fullName,
    avatarUrl,
  };
}

/** Iniciais para o avatar de fallback (ex: "Ana Lima" → "AL"). */
export function getInitials(fullName: string): string {
  return (
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}
