import { Pagination } from "@/components/ui/pagination";
import { lecturesHref } from "@/modules/lecture/lecture.routes";
import type { LectureFilters, LectureSort } from "@/modules/lecture/lecture.types";

/**
 * Paginação da grid de Palestras (§18).
 *
 * ⚠️ O DESENHO SAIU DAQUI e virou `@/components/ui/pagination` — este arquivo
 * era idêntico a `survey-pagination.tsx`, e a tela de Inscrições precisava do
 * mesmo. O que sobrou é o que só Palestras tem: como serializar OS FILTROS
 * DELA num endereço.
 *
 * O nome exportado continua o mesmo, e `lectures/page.tsx` não mudou.
 */
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
  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      href={(target) => lecturesHref({ filters, sort, page: target, pageSize })}
      label="Paginação das palestras"
      noun={["palestra", "palestras"]}
    />
  );
}
