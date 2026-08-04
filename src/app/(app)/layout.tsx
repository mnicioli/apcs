import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentUserRole } from "@/lib/auth/current-user";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * Shell das rotas autenticadas. O middleware já redireciona anônimos, mas
 * checamos de novo aqui (defesa em profundidade) antes de renderizar.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const role = await getCurrentUserRole();

  return (
    <div className="flex min-h-dvh">
      <Sidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} role={role} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
