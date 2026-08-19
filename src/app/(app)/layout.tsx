import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { countPendingLectures } from "@/lib/services/lectures";
import { countPendingMembershipApplications } from "@/lib/services/membership";
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

  const role = await getCurrentUserRole();
  // As duas contagens em paralelo: são independentes, e somar dois tempos de
  // ida ao banco em SÉRIE no layout atrasaria TODAS as telas do sistema.
  const [lecturesPending, membershipPending] = await Promise.all([
    hasPermission(role, "lectures.read") ? countPendingLectures() : 0,
    hasPermission(role, "members.read") ? countPendingMembershipApplications() : 0,
  ]);

  return (
    <div className="flex min-h-dvh">
      <Sidebar role={role} badges={{ lecturesPending, membershipPending }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} role={role} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
