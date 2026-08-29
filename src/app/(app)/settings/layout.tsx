import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { SETTINGS_SUBTITLE, SETTINGS_TITLE } from "@/modules/admin/admin.labels";
import { SettingsTabs } from "./settings-tabs";

/**
 * O CASCO DE CONFIGURAÇÕES — cabeçalho, abas e a barreira de permissão.
 *
 * ⚠️ A CHECAGEM MORA AQUI, e não repetida em cada aba. Um layout de rota do App
 * Router roda antes de qualquer página abaixo dele, então `/settings/segments`
 * não tem como ser aberta pulando esta linha. Repetir o `redirect` em quatro
 * arquivos seria quatro chances de esquecer no quinto.
 *
 * (As páginas ainda assim não confiam só nisso: cada função do banco confere
 * `is_admin()` por conta própria. Camadas.)
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "settings.manage")) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{SETTINGS_TITLE}</h1>
        <p className="text-muted-foreground text-sm">{SETTINGS_SUBTITLE}</p>
      </div>

      <SettingsTabs />

      {children}
    </div>
  );
}
