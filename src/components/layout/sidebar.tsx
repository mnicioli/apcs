"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemVisible, NAV_SECTIONS, type NavBadge } from "@/config/navigation";
import { ApcsLogo } from "@/components/brand/apcs-logo";
import { hasPermission } from "@/lib/rbac/rbac.config";
import type { Role } from "@/lib/rbac/rbac.types";
import { cn } from "@/lib/utils";

/**
 * Navegação lateral. Filtra os itens pelo papel do usuário e destaca a rota
 * ativa. Itens de roadmap (`available: false`) aparecem desabilitados com o
 * selo "Em breve".
 *
 * `badges` traz os contadores já apurados pelo layout (que é servidor). A
 * navegação não busca dado — ela desenha o que recebe.
 */
export function Sidebar({
  role,
  badges = {},
}: {
  role: Role;
  badges?: Partial<Record<NavBadge, number>>;
}) {
  const pathname = usePathname();

  return (
    <aside className="border-border bg-card hidden w-64 shrink-0 flex-col border-r md:flex">
      {/*
        A ASSINATURA DA APCS abre a navegação — desenho, fio e nome por extenso.
        Antes era a sigla "APCS" em texto, que não dizia a quem serve o sistema.

        `px-4` (era `px-6`) e `height={28}` não são estética: a lateral tem
        256px, e a assinatura inteira em 36px de altura com 24px de recuo de
        cada lado empurra "Associação Paulista de" para uma terceira linha, que
        não cabe na barra de 56px. Medido, não chutado.

        `responsive={false}` porque a lateral só existe a partir de `md` — o
        corte por largura do componente nunca dispararia aqui, e deixá-lo ligado
        só esconderia o nome de quem lesse o código.
      */}
      <div className="border-border flex h-14 items-center border-b px-4">
        <Link href="/dashboard" aria-label="Ir para o painel">
          <ApcsLogo height={28} responsive={false} />
        </Link>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto p-4">
        {NAV_SECTIONS.map((section) => {
          // A regra mora em `isNavItemVisible` (navigation.ts), e não aqui: ela
          // mistura "escondido" com "sem permissão", que se parecem e não são a
          // mesma coisa. Lá ela é testada sem renderizar nada.
          const items = section.items.filter((item) => isNavItemVisible(item, role, hasPermission));
          // Seção que ficou sem item nenhum não vira um título solto.
          if (items.length === 0) return null;

          return (
            <div key={section.title}>
              <p className="text-muted-foreground mb-2 px-2 text-xs font-medium tracking-wider uppercase">
                {section.title}
              </p>
              <ul className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  // ⚠️ `startsWith` sozinho marcaria "Palestras" (/lectures)
                  // como ativo enquanto se navega no calendário
                  // (/lectures/calendar) — dois itens acesos ao mesmo tempo. A
                  // checagem de item mais específico resolve sem caso especial:
                  // se existir outro item cujo href seja um prefixo mais longo
                  // e case com a rota, este aqui não é o ativo.
                  const isActive =
                    pathname === item.href ||
                    (pathname.startsWith(`${item.href}/`) &&
                      !items.some(
                        (other) =>
                          other.href.length > item.href.length &&
                          (pathname === other.href || pathname.startsWith(`${other.href}/`)),
                      ));
                  const count = item.badge ? (badges[item.badge] ?? 0) : 0;

                  if (!item.available) {
                    return (
                      <li key={item.href}>
                        <span className="text-muted-foreground/60 flex cursor-default items-center gap-3 rounded-md px-2 py-2 text-sm">
                          <Icon className="h-4 w-4" />
                          <span className="flex-1">{item.title}</span>
                          <span className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
                            Em breve
                          </span>
                        </span>
                      </li>
                    );
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-foreground hover:bg-muted",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{item.title}</span>
                        {count > 0 && (
                          <span
                            className={cn(
                              "min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold",
                              isActive
                                ? "bg-primary-foreground text-primary"
                                : "bg-accent text-primary-strong",
                            )}
                          >
                            {/* O número é lido por leitor de tela com o que ele
                                significa: "3" sozinho não diz nada. */}
                            <span aria-hidden="true">{count}</span>
                            <span className="sr-only">
                              {count === 1
                                ? "1 solicitação aguardando análise"
                                : `${count} solicitações aguardando análise`}
                            </span>
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
