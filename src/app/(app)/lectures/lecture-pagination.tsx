import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { lecturesHref } from "@/modules/lecture/lecture.routes";
import type { LectureFilters, LectureSort } from "@/modules/lecture/lecture.types";

/**
 * Paginação da grid (§18).
 *
 * São LINKS, não botões: a página é renderizada no servidor, então trocar de
 * página é navegar. De quebra, "abrir em nova aba" funciona, o botão voltar do
 * navegador funciona, e a página atual sobrevive ao F5.
 *
 * A janela de números é curta e centrada na página atual — com 40 páginas, uma
 * régua com as 40 ocuparia mais espaço que a própria grid.
 */
const WINDOW = 2;

export function LecturePagination({
  page,
  pageSize,
  total,
  filters,
  sort,
}: {
  page: number;
  pageSize: number;
  total: number;
  filters: LectureFilters;
  sort: LectureSort;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const first = Math.max(1, page - WINDOW);
  const last = Math.min(pages, page + WINDOW);
  const numbers = Array.from({ length: last - first + 1 }, (_, index) => first + index);

  const href = (target: number) => lecturesHref({ filters, sort, page: target, pageSize });

  const primeiro = (page - 1) * pageSize + 1;
  const ultimo = Math.min(page * pageSize, total);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-4"
      aria-label="Paginação das palestras"
    >
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {primeiro}–{ultimo} de {total} {total === 1 ? "palestra" : "palestras"}
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
