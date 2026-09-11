import type { Metadata } from "next";
import { APP_SHORT_NAME } from "@/config/app";
import { getPublicEvaluation } from "@/lib/services/event-evaluation-public";
import { formatCalendarDate } from "@/lib/utils";
import { PUBLIC_EVALUATION_COPY } from "@/modules/event/event.evaluation.labels";
import { CabecalhoInstitucional, RodapeInstitucional } from "@/app/eventos/[slug]/landing-chrome";
import { EvaluationForm } from "./evaluation-form";

/**
 * A PÁGINA PÚBLICA DA AVALIAÇÃO — `/avaliacoes/<token>`.
 *
 * É a terceira página que qualquer um abre sem estar logado (as outras são
 * `/associe-se` e `/eventos/<slug>`), e a rota está na lista pública do
 * middleware. Sem isso, quem clicasse no link do WhatsApp cairia em `/login` —
 * e não tem login nenhum para fazer.
 *
 * ============================================================================
 * ⚠️ A IDENTIDADE VISUAL É A MESMA DAS OUTRAS PÁGINAS PÚBLICAS (§28).
 * ============================================================================
 * `CabecalhoInstitucional` e `RodapeInstitucional` são IMPORTADOS de
 * `/eventos/[slug]/landing-chrome.tsx`, e não copiados. O §28 pede consistência
 * e proíbe identidade paralela; uma segunda cópia dos dois logos divergiria no
 * dia em que a marca mudasse — que é exatamente o que já aconteceu uma vez
 * neste projeto (ver o comentário sobre `CspiMark` naquele arquivo).
 *
 * ============================================================================
 * ⚠️ SEM CACHE, E É POR CAUSA DO ESTADO (§20, §18).
 * ============================================================================
 * `force-dynamic` porque a resposta desta página muda: a avaliação expira, é
 * respondida, é cancelada. Uma página estática ofereceria um formulário que o
 * banco recusa — ou, pior, mostraria o formulário de novo para quem já
 * respondeu.
 *
 * ============================================================================
 * ⚠️ O QUE ESTA PÁGINA NÃO MOSTRA
 * ============================================================================
 * Nenhum id interno (§6, §29), nenhum dado cadastral editável (§29), nenhuma
 * informação administrativa (§27). O nome que aparece é o PRIMEIRO NOME, e não
 * o completo: o link pode ser reencaminhado, e "Olá, João" cumpre o §29 sem
 * entregar o nome inteiro a quem receber o endereço de segunda mão.
 */
export const dynamic = "force-dynamic";

/**
 * ⚠️ `noindex` — ESTA PÁGINA NÃO PODE SER INDEXADA (§33, §34).
 *
 * O endereço CONTÉM a credencial. Um buscador que o rastreie publica o token, e
 * qualquer pessoa passa a poder responder no lugar do participante. Não há
 * prévia de Open Graph aqui pelo mesmo motivo: a mensagem vai por WhatsApp, e o
 * aplicativo busca a prévia — o que já basta de exposição.
 */
export const metadata: Metadata = {
  title: `Pesquisa de opinião — ${APP_SHORT_NAME}`,
  robots: { index: false, follow: false, nocache: true },
};

export default async function PublicEvaluationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const avaliacao = await getPublicEvaluation(token);

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <CabecalhoInstitucional />

      <main className="mx-auto w-full max-w-[46rem] flex-1 px-5 py-8">
        {avaliacao.state === "ok" ? (
          <>
            <header className="mb-6 space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {PUBLIC_EVALUATION_COPY.title}
              </h1>
              <p className="text-lg">{PUBLIC_EVALUATION_COPY.greeting(avaliacao.firstName)}</p>
              <p className="text-muted-foreground text-sm">
                {avaliacao.eventName}
                {avaliacao.eventDate && ` · ${formatCalendarDate(avaliacao.eventDate)}`}
                {avaliacao.eventLocation && ` · ${avaliacao.eventLocation}`}
              </p>
              <p className="text-muted-foreground text-sm">{PUBLIC_EVALUATION_COPY.intro}</p>
            </header>

            <EvaluationForm token={token} sections={avaliacao.sections} />
          </>
        ) : (
          <Recado state={avaliacao.state} />
        )}
      </main>

      <RodapeInstitucional />
    </div>
  );
}

/**
 * Os becos sem saída (§18, §20, §27, §33).
 *
 * ⚠️ NENHUM DELES OFERECE UM BOTÃO, e é de propósito: quem chega aqui não tem o
 * que fazer na página, e um "tentar novamente" mandaria a pessoa repetir a única
 * coisa que nunca vai funcionar.
 *
 * ⚠️ `cancelled` E `not_found` MOSTRAM A MESMA FRASE (§33). Distinguir as duas
 * contaria a quem estivesse adivinhando tokens quando o palpite acertou o
 * formato — e não acrescentaria nada para quem chegou aqui de boa-fé.
 */
function Recado({ state }: { state: "answered" | "expired" | "cancelled" | "not_found" }) {
  const { titulo, corpo } =
    state === "answered"
      ? {
          titulo: PUBLIC_EVALUATION_COPY.answeredTitle,
          corpo: PUBLIC_EVALUATION_COPY.answeredBody,
        }
      : state === "expired"
        ? {
            titulo: PUBLIC_EVALUATION_COPY.expiredTitle,
            corpo: PUBLIC_EVALUATION_COPY.expiredBody,
          }
        : {
            titulo: PUBLIC_EVALUATION_COPY.unavailableTitle,
            corpo: PUBLIC_EVALUATION_COPY.unavailableBody,
          };

  return (
    <div className="border-border bg-card rounded-lg border px-6 py-10 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{corpo}</p>
    </div>
  );
}
