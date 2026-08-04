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

export function toSessionUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): SessionUser {
  const metadata = user.user_metadata ?? {};
  const fullName =
    typeof metadata.full_name === "string" && metadata.full_name.trim().length
      ? metadata.full_name
      : (user.email ?? "");
  const rawAvatar = typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;
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
