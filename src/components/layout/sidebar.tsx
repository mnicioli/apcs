"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { isNavItemVisible, NAV_SECTIONS, type NavBadge, type NavItem } from "@/config/navigation";
import { ApcsLogo } from "@/components/brand/apcs-logo";
import type { Permission } from "@/lib/rbac/rbac.types";
import { cn } from "@/lib/utils";

/**
 * Navegação lateral. Filtra os itens pelas permissões do cargo e destaca a rota
 * ativa. Itens de roadmap (`available: false`) aparecem desabilitados com o
 * selo "Em breve".
 *
 * ⚠️ RECEBE AS PERMISSÕES PRONTAS, e não o cargo. Desde
 * 20260903000100_custom_roles.sql a matriz mora no BANCO, e este componente
 * roda no NAVEGADOR — ele não tem como consultá-la. Quem resolve é o layout,
 * que é servidor. Passar o cargo e chamar `hasPermission` aqui funcionaria só
 * para os quatro embutidos e esconderia o menu inteiro de quem tem um cargo
 * criado pela APCS.
 *
 * `badges` traz os contadores já apurados pelo layout. A navegação não busca
 * dado — ela desenha o que recebe.
 */

const CHAVE_ARMAZENAMENTO = "apcs.nav.sections";

type Abertas = Record<string, boolean>;

function padroes(): Abertas {
  return Object.fromEntries(NAV_SECTIONS.map((secao) => [secao.title, secao.defaultOpen === true]));
}

/**
 * O que a pessoa deixou aberto da última vez.
 *
 * ⚠️ TUDO EM `try`, e o retorno de falha é o padrão. `localStorage` lança em
 * janela anônima com dados de site bloqueados — e um menu que não desenha
 * porque não conseguiu lembrar de uma preferência é uma troca péssima.
 *
 * ⚠️ O ARMAZENADO É MESCLADO SOBRE O PADRÃO, nunca usado sozinho. Uma seção
 * nova (que ainda não existia quando a preferência foi gravada) precisa
 * aparecer com o padrão dela, e não sumir por não estar no objeto salvo.
 */
function lerArmazenado(): Abertas {
  const base = padroes();
  try {
    const cru = window.localStorage.getItem(CHAVE_ARMAZENAMENTO);
    if (!cru) return base;

    const salvo: unknown = JSON.parse(cru);
    if (typeof salvo !== "object" || salvo === null) return base;

    for (const [titulo, aberta] of Object.entries(salvo as Record<string, unknown>)) {
      if (titulo in base && typeof aberta === "boolean") base[titulo] = aberta;
    }
    return base;
  } catch {
    return base;
  }
}

function guardar(abertas: Abertas): void {
  try {
    window.localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(abertas));
  } catch {
    // Sem armazenamento a preferência vale só para esta sessão. Nada a fazer.
  }
}

/** A rota atual está dentro deste item? Mesma regra do destaque. */
function cobreRota(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function Sidebar({
  permissions,
  badges = {},
}: {
  permissions: readonly Permission[];
  badges?: Partial<Record<NavBadge, number>>;
}) {
  const pathname = usePathname();

  const secoes = useMemo(() => {
    const permitidas = new Set(permissions);
    const pode = (permissao: Permission) => permitidas.has(permissao);

    return NAV_SECTIONS.map((secao) => ({
      ...secao,
      // A regra mora em `isNavItemVisible` (navigation.ts), e não aqui: ela
      // mistura "escondido" com "sem permissão", que se parecem e não são a
      // mesma coisa. Lá ela é testada sem renderizar nada.
      items: secao.items.filter((item) => isNavItemVisible(item, pode)),
      // Seção que ficou sem item nenhum não vira um título solto.
    })).filter((secao) => secao.items.length > 0);
  }, [permissions]);

  /*
    ⚠️ COMEÇA NOS PADRÕES, E SÓ DEPOIS LÊ O QUE ESTÁ GUARDADO.

    Ler `localStorage` durante a renderização faria o HTML do servidor
    (que não tem acesso a ele) discordar do primeiro desenho do navegador — o
    erro de hidratação do React. O preço é um quadro com o menu no padrão antes
    de ele assumir a preferência; a alternativa era um aviso vermelho no console
    de todo mundo.
  */
  const [abertas, setAbertas] = useState<Abertas>(padroes);

  useEffect(() => {
    setAbertas(lerArmazenado());
  }, []);

  /*
    ⚠️ A SEÇÃO DA TELA EM QUE SE ESTÁ ABRE SOZINHA, e sem isto o recurso seria
    um defeito: com Documentos recolhido, abrir uma normativa mostraria um menu
    onde nada está aceso — a pessoa perderia a referência de onde está.

    Roda a cada navegação, e não só na montagem, porque a lateral NÃO é
    remontada ao trocar de rota (ela vive no layout). Continua sendo possível
    recolher a seção atual com a mão; ela só volta a abrir ao navegar de novo
    para dentro dela.
  */
  useEffect(() => {
    const atual = NAV_SECTIONS.find((secao) =>
      secao.items.some((item) => cobreRota(item, pathname)),
    );
    if (!atual) return;

    setAbertas((anterior) =>
      anterior[atual.title] ? anterior : { ...anterior, [atual.title]: true },
    );
  }, [pathname]);

  function alternar(titulo: string): void {
    setAbertas((anterior) => {
      const proximo = { ...anterior, [titulo]: !anterior[titulo] };
      guardar(proximo);
      return proximo;
    });
  }

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

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {secoes.map((section) => {
          const aberta = abertas[section.title] ?? false;
          const idLista = `nav-secao-${section.title.toLowerCase().replace(/\s+/g, "-")}`;

          /*
            ⚠️ O CONTADOR DA SEÇÃO EXISTE POR CAUSA DO RECOLHIMENTO, e sem ele
            este recurso esconderia trabalho. "3 solicitações aguardando" é a
            informação que faz alguém abrir Associados — se ela só aparece
            depois de abrir, ninguém abre.
          */
          const pendentes = section.items.reduce(
            (total, item) => total + (item.badge ? (badges[item.badge] ?? 0) : 0),
            0,
          );

          return (
            <div key={section.title} className="pb-2">
              <button
                type="button"
                onClick={() => alternar(section.title)}
                aria-expanded={aberta}
                aria-controls={idLista}
                className="text-muted-foreground hover:text-foreground hover:bg-muted/60 mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium tracking-wider uppercase transition-colors"
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-transform",
                    !aberta && "-rotate-90",
                  )}
                  aria-hidden="true"
                />
                <span className="flex-1 text-left">{section.title}</span>
                {!aberta && pendentes > 0 && (
                  <span className="bg-accent text-primary-strong min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold">
                    <span aria-hidden="true">{pendentes}</span>
                    <span className="sr-only">
                      {pendentes === 1 ? "1 item aguardando" : `${pendentes} itens aguardando`}
                    </span>
                  </span>
                )}
              </button>

              {aberta && (
                <ul id={idLista} className="space-y-1">
                  {section.items.map((item) => {
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
                        !section.items.some(
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
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
