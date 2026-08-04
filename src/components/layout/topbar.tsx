import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { logoutAction } from "@/lib/auth/actions";
import { getInitials, type SessionUser } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/rbac/rbac.types";
import { Button } from "@/components/ui/button";

/**
 * Barra superior: identificação do usuário, atalho para o perfil e logout.
 * É um Server Component — o logout usa Server Action via `<form action>`.
 */
export function Topbar({ user, role }: { user: SessionUser; role: Role }) {
  return (
    <header className="border-border bg-background flex h-14 shrink-0 items-center justify-end gap-3 border-b px-4">
      <div className="hidden text-right sm:block">
        <p className="text-sm leading-tight font-medium">{user.fullName}</p>
        <p className="text-muted-foreground text-xs">{ROLE_LABELS[role]}</p>
      </div>

      <Link
        href="/profile"
        aria-label="Meu perfil"
        className="bg-muted hover:bg-muted/70 flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar de host externo permitido; next/image exige config de remotePatterns
          <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          getInitials(user.fullName)
        )}
      </Link>

      <Link href="/profile" aria-label="Meu perfil" className="sm:hidden">
        <Button variant="ghost" size="icon">
          <UserRound className="h-4 w-4" />
        </Button>
      </Link>

      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sair</span>
        </Button>
      </form>
    </header>
  );
}
