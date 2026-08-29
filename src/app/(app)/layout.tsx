import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import {
  getCurrentPermissions,
  getCurrentUser,
  getCurrentUserRole,
  isCurrentUserActive,
} from "@/lib/auth/current-user";
import { logoutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getRoleLabel } from "@/lib/services/roles";
import { countPendingLectures } from "@/lib/services/lectures";
import { countPendingMembershipApplications } from "@/lib/services/membership";
import { countUnreadWhatsAppChats } from "@/lib/services/whatsapp";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * Shell das rotas autenticadas. O middleware já redireciona anônimos, mas
 * checamos de novo aqui (defesa em profundidade) antes de renderizar.
 *
 * ⚠️ Os CONTADORES do menu são apurados aqui, e só para quem tem permissão de
 * ver o módulo. Um contador é informação: "há 3 solicitações esperando" já conta
 * algo sobre a operação da APCS a quem não deveria ver a tela. A leitura custa
 * uma contagem sem trazer linha (`head: true`) e devolve 0 em vez de lançar —
 * um contador indisponível não pode derrubar o menu de todas as telas.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  /*
    ⚠️ A CONTA DESLIGADA PARA AQUI, e não com um `redirect` para `/login`.

    O middleware manda quem TEM sessão e abre `/login` de volta para o painel —
    um redirect daqui entraria em pingue-pongue com ele até o navegador desistir.
    A sessão só termina quando a pessoa clica em sair, e sair é uma Server Action
    (POST): fazer isso por um GET automático seria um logout que qualquer imagem
    de terceiro consegue disparar.

    Enquanto ela não sai, nada vaza: `getCurrentUserRole` já devolveu `viewer`,
    e no banco `current_app_role()` também — nenhuma policy entrega uma linha.
    O que esta tela acrescenta é a EXPLICAÇÃO, sem a qual a pessoa veria um
    sistema vazio e abriria um chamado.
  */
  if (!(await isCurrentUserActive())) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="border-border bg-card w-full max-w-md rounded-lg border p-6 text-center shadow-sm">
          <Lock className="text-muted-foreground mx-auto h-8 w-8" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">Seu acesso foi desativado</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            A conta {user.email} não está mais ativa no sistema da APCS. Se isso não deveria ter
            acontecido, fale com um administrador.
          </p>
          <form action={logoutAction} className="mt-5">
            <Button type="submit" variant="outline" className="w-full">
              Sair
            </Button>
          </form>
        </div>
      </main>
    );
  }

  const role = await getCurrentUserRole();
  // ⚠️ AS PERMISSÕES SÃO RESOLVIDAS AQUI porque a Sidebar roda no navegador e
  // a matriz mora no banco. Ver o comentário no topo de sidebar.tsx.
  const [permissions, roleLabel] = await Promise.all([getCurrentPermissions(), getRoleLabel(role)]);
  // As contagens em paralelo: são independentes, e somar os tempos de ida ao
  // banco em SÉRIE no layout atrasaria TODAS as telas do sistema.
  const [lecturesPending, membershipPending, whatsappUnread] = await Promise.all([
    hasPermission(role, "lectures.read") ? countPendingLectures() : 0,
    hasPermission(role, "members.read") ? countPendingMembershipApplications() : 0,
    hasPermission(role, "whatsapp.read") ? countUnreadWhatsAppChats() : 0,
  ]);

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        permissions={permissions}
        badges={{ lecturesPending, membershipPending, whatsappUnread }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} roleLabel={roleLabel} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
