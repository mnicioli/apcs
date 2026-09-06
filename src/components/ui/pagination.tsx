import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A PAGINAÇÃO DAS LISTAGENS — uma só, para todas as telas.
 *
 * ============================================================================
 * ⚠️ ELA EXISTIA DUAS VEZES, E IA VIRAR TRÊS.
 * ============================================================================
 * `lecture-pagination.tsx` e `survey-pagination.tsx` são o MESMO componente: a
 * mesma janela de números, o mesmo `aria-current`, o mesmo `<span>` nas pontas,
 * o mesmo "1–25 de 132". O que difere entre elas são duas coisas — como montar
 * o endereço de cada página e qual substantivo aparece no rodapé.
 *
 * A tela de Inscrições precisava da mesma coisa, e o §32 do Prompt 4 é explícito
 * ("não duplicar código existente"). Em vez de uma terceira cópia, o desenho
 * comum subiu para cá e as duas de baixo passaram a delegar, preservando os
 * nomes que as páginas delas já importavam.
 *
 * ⚠️ SÃO LINKS, NÃO BOTÕES. As páginas são renderizadas no servidor, então
 * trocar de página é NAVEGAR. De quebra: "abrir em nova aba" funciona, o botão
 * voltar do navegador funciona, e a página atual sobrevive ao F5.
 */

/** Quantos números aparecem de cada lado do atual. */
const WINDOW = 2;

export function Pagination({
  page,
  pageSize,
  total,
  href,
  label,
  noun,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Como chegar a uma página. Cada tela serializa os filtros do seu jeito. */
  href: (page: number) => string;
  /** O `aria-label` do `<nav>` — ex.: "Paginação das palestras". */
  label: string;
  /** Singular e plural do que se conta: `["palestra", "palestras"]`. */
  noun: readonly [string, string];
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Uma página só não é paginação: a régua desapareceria em toda tela pequena.
  if (pages <= 1) return null;

  const first = Math.max(1, page - WINDOW);
  const last = Math.min(pages, page + WINDOW);
  const numbers = Array.from({ length: last - first + 1 }, (_, index) => first + index);

  const primeiro = (page - 1) * pageSize + 1;
  const ultimo = Math.min(page * pageSize, total);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-4" aria-label={label}>
      {/* `aria-live` porque este texto é a única confirmação de que a navegação
          aconteceu — quem não vê a tela precisa ouvir "26–50 de 132". */}
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {primeiro}–{ultimo} de {total} {total === 1 ? noun[0] : noun[1]}
      </p>

      <ul className="flex items-center gap-1">
        <li>
          <PageLink
            href={href(page - 1)}
            disabled={page === 1}
            label="Página anterior"
            icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          />
        </li>

        {first > 1 && (
          <li aria-hidden="true" className="text-muted-foreground px-1 text-sm">
            …
          </li>
        )}

        {numbers.map((number) => (
          <li key={number}>
            <Link
              href={href(number)}
              aria-current={number === page ? "page" : undefined}
              className={
                number === page
                  ? "bg-primary text-primary-foreground inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium"
                  : "text-foreground hover:bg-muted inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm transition-colors"
              }
            >
              {number}
            </Link>
          </li>
        ))}

        {last < pages && (
          <li aria-hidden="true" className="text-muted-foreground px-1 text-sm">
            …
          </li>
        )}

        <li>
          <PageLink
            href={href(page + 1)}
            disabled={page === pages}
            label="Próxima página"
            icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
          />
        </li>
      </ul>
    </nav>
  );
}

/**
 * Nas pontas o controle vira `span`, e não um link desabilitado.
 *
 * Um `<a>` sem destino continua recebendo foco do teclado e continua sendo
 * anunciado como link pelo leitor de tela — a pessoa navegaria até ele e não
 * aconteceria nada.
 */
function PageLink({
  href,
  disabled,
  label,
  icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span
        aria-hidden="true"
        className="text-muted-foreground/40 inline-flex h-8 w-8 items-center justify-center rounded-md"
      >
        {icon}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className="text-foreground hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
    >
      {icon}
    </Link>
  );
}
