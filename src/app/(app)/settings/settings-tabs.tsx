"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_TABS } from "@/modules/admin/admin.labels";

/**
 * As abas de Configurações.
 *
 * ⚠️ SÃO LINKS, e não estado de componente. Cada aba é uma rota de verdade:
 * dá para mandar "abre em /settings/notifications" por mensagem, o F5 mantém
 * onde a pessoa estava, e o botão voltar do navegador faz o que se espera. Um
 * `useState` com quatro `if` daria a mesma tela e nenhuma dessas três coisas.
 *
 * ⚠️ A comparação é EXATA (`===`), e não `startsWith`. A primeira aba é
 * `/settings`, que é prefixo de todas as outras — com `startsWith` ela ficaria
 * acesa junto com a aba que a pessoa realmente abriu.
 */
export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções de configurações" className="flex flex-wrap gap-2">
      {SETTINGS_TABS.map((aba) => {
        const ativa = pathname === aba.href;
        return (
          <Link
            key={aba.href}
            href={aba.href}
            aria-current={ativa ? "page" : undefined}
            className={
              ativa
                ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                : "text-muted-foreground hover:bg-muted rounded-md px-3 py-1.5 text-sm transition-colors"
            }
          >
            {aba.label}
          </Link>
        );
      })}
    </nav>
  );
}
