import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { NAV_SECTIONS } from "@/config/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const firstName = user?.fullName?.split(" ")[0] ?? "";

  // Achata os módulos das seções para mostrar o roadmap (exceto a própria seção "Geral").
  const modules = NAV_SECTIONS.filter((s) => s.title !== "Geral").flatMap((s) => s.items);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName} 👋</h1>
        <p className="text-muted-foreground mt-1">
          Este é o ponto de partida do FAST Operation Cockpit. Os módulos abaixo são o roadmap do
          produto — implemente um de cada vez seguindo o padrão de referência.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <Card key={mod.href} className="relative">
              <CardHeader>
                <div className="bg-muted mb-2 flex h-9 w-9 items-center justify-center rounded-md">
                  <Icon className="text-muted-foreground h-5 w-5" />
                </div>
                <CardTitle className="text-base">{mod.title}</CardTitle>
                <CardDescription>
                  {mod.available ? "Disponível" : "Em breve — no roadmap"}
                </CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
