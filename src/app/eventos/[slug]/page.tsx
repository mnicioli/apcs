import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CalendarDays, Clock, MapPin } from "lucide-react";
import { SignedImage } from "@/components/ui/signed-image";
import { APP_SHORT_NAME } from "@/config/app";
import { getPublicLandingPage } from "@/lib/services/event-landing-public";
import { formatCalendarDate, formatDateTime } from "@/lib/utils";
import { PUBLIC_LANDING_COPY } from "@/modules/event/event.landing.labels";
import {
  landingEffectiveStatus,
  landingStatusReason,
  withEventDate,
} from "@/modules/event/event.landing.rules";
import type {
  PublicLandingPage,
  PublicRegistrationState,
} from "@/modules/event/event.landing.types";
import { formatTimeRange } from "@/modules/event/event.rules";
import { CabecalhoInstitucional, RodapeInstitucional } from "./landing-chrome";
import { RegistrationForm } from "./registration-form";

/**
 * A PÁGINA PÚBLICA DE INSCRIÇÃO — `/eventos/<slug>`.
 *
 * É a segunda página do sistema que qualquer um na internet abre sem estar
 * logado (a outra é `/associe-se`), e a rota está na lista pública do
 * middleware. Sem isso, o visitante seria mandado para `/login` — o
 * comportamento certo para todo o resto do sistema e o errado para esta página.
 *
 * ============================================================================
 * ⚠️ O SERVIDOR DECIDE SE AS INSCRIÇÕES ESTÃO ABERTAS (§29)
 * ============================================================================
 * `landingEffectiveStatus` roda AQUI, com o relógio do servidor, e o resultado
 * desce como `initialState`. A tela nunca conclui sozinha que o prazo venceu —
 * o relógio do celular de quem abre a página pode estar em qualquer hora.
 *
 * E esta é a PRIMEIRA das três conferências que o §29 pede: no carregamento
 * (aqui), no envio (o schema do formulário) e no banco
 * (`create_event_registration`, sob lock). A última é a que vale: entre o
 * instante em que esta página foi desenhada e o instante em que alguém aperta
 * "confirmar", outra granja pode ter levado as últimas vagas.
 *
 * ⚠️ SEM CACHE, E É POR CAUSA DAS VAGAS. `force-dynamic` porque
 * `participantCount` muda a cada inscrição: uma página estática mostraria
 * "restam 3 vagas" horas depois de esgotar, e ofereceria um formulário que o
 * banco recusa. `/associe-se` pode ser estática (o texto de consentimento muda
 * duas vezes por ano); esta não pode.
 */
export const dynamic = "force-dynamic";

/**
 * ⚠️ `cache` DO REACT PORQUE A LEITURA ACONTECE DUAS VEZES POR REQUISIÇÃO:
 * `generateMetadata` e o componente pedem a mesma página. Sem isto seriam duas
 * chamadas ao Postgres e duas assinaturas de URL no Storage para desenhar uma
 * tela — o oposto do que o §33 pede.
 */
const carregar = cache(getPublicLandingPage);

/**
 * §39 — o que aparece quando alguém cola o link no WhatsApp.
 *
 * ⚠️ NENHUM DADO PESSOAL AQUI, e nenhuma informação interna do evento: nome,
 * data e a descrição pública. A imagem NÃO entra no Open Graph, e a ausência é
 * deliberada — ela vive em bucket privado e o que temos é uma URL ASSINADA que
 * expira em uma hora. Um `og:image` que morre em sessenta minutos é pior que
 * nenhum: o WhatsApp guarda a prévia em cache e passaria a mostrar um retângulo
 * quebrado para todo mundo que recebesse o link depois disso.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await carregar(slug);

  if (!page) {
    return { title: "Página não encontrada", robots: { index: false, follow: false } };
  }

  const titulo = `${page.event.name} | ${APP_SHORT_NAME}`;
  const descricao =
    page.description?.trim().slice(0, 300) ??
    `Inscrições para ${page.event.name}, em ${formatCalendarDate(page.event.eventDate)}.`;

  return {
    title: titulo,
    description: descricao,
    openGraph: { title: titulo, description: descricao, type: "website" },
    // A página existe para ser encontrada e compartilhada (§40) — como
    // `/associe-se`, e ao contrário de todo o resto do sistema.
    robots: { index: true, follow: true },
  };
}

export default async function PaginaPublicaDeInscricao({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await carregar(slug);

  // §4 e §5 — rascunho, inativa e slug inexistente respondem a MESMA coisa. A
  // função Postgres não os distingue, e por isso aqui também não há como.
  if (!page) notFound();

  const agora = new Date();
  const efetiva = landingEffectiveStatus(withEventDate(page), agora);
  const motivo = landingStatusReason(withEventDate(page), agora);

  // "Encerrada porque lotou" e "encerrada porque o prazo venceu" são a mesma
  // situação para o banco e frases diferentes para quem lê (§27 e §28).
  const estadoInicial: PublicRegistrationState =
    efetiva === "published" ? "ready" : motivo === "full" ? "soldOut" : "closed";

  return (
    <>
      <CabecalhoInstitucional />

      <main className="mx-auto max-w-[46rem] px-5 py-8 sm:px-6 sm:py-12">
        <CabecalhoDoEvento page={page} />

        <div className="mt-8">
          {/*
            ⚠️ CAMPO A CAMPO, E NÃO `page={page}` (§33). O formulário é um Client
            Component: tudo o que descer por esta prop é serializado no payload
            do RSC e chega ao navegador. A página inteira carrega a contagem de
            inscritos, a capacidade, o prazo e a situação — nada disso é
            desenhado ali, e "não é usado" não é o mesmo que "não foi enviado".

            Escrever os campos à mão é o que faz um acréscimo futuro à leitura
            pública precisar de uma DECISÃO para chegar ao navegador, em vez de
            chegar por distração.
          */}
          <RegistrationForm
            page={{
              slug: page.slug,
              formFields: page.formFields,
              successTitle: page.successTitle,
              successMessage: page.successMessage,
              successFooter: page.successFooter,
              successDefaults: page.successDefaults,
              event: page.event,
              consent: page.consent,
            }}
            initialState={estadoInicial}
          />
        </div>
      </main>

      <RodapeInstitucional />
    </>
  );
}

/**
 * §8 — a imagem, o título, a descrição, a data e o horário.
 *
 * ⚠️ O TÍTULO É O NOME DO EVENTO, e é um `<h1>`. Não há campo para
 * sobrescrevê-lo: é a decisão do §9 do Prompt 2 — mudar o título da página não
 * pode mudar o nome oficial do evento, e dois nomes para a mesma coisa é como
 * eles passam a divergir.
 *
 * ⚠️ NADA DE INTERNO CHEGA AQUI porque nada de interno chegou ao servidor:
 * `PublicLandingPage` simplesmente não tem `eventId`, autores, segmentação nem
 * `registration_url`. Ver o cabeçalho de `get_public_event_landing_page`.
 */
function CabecalhoDoEvento({ page }: { page: PublicLandingPage }) {
  const vagas =
    page.maxParticipants === null
      ? null
      : Math.max(page.maxParticipants - page.participantCount, 0);

  return (
    <article className="space-y-5">
      {page.imageUrl && (
        <SignedImage
          url={page.imageUrl}
          alt={`Imagem de ${page.event.name}`}
          sizes="w-full"
          className="h-auto w-full rounded-2xl object-contain"
        />
      )}

      <div className="space-y-3 text-center">
        <h1 className="font-display text-primary-strong text-2xl leading-tight font-extrabold tracking-tight uppercase sm:text-3xl">
          {page.event.name}
        </h1>

        <dl className="text-muted-foreground flex flex-col items-center gap-1.5 text-sm">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Data</dt>
            <dd>{formatCalendarDate(page.event.eventDate)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 shrink-0" aria-hidden="true" />
            <dt className="sr-only">Horário</dt>
            <dd>{formatTimeRange(page.event.startTime, page.event.endTime)}</dd>
          </div>
          {page.event.location && (
            <div className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              <dt className="sr-only">Local</dt>
              <dd>{page.event.location}</dd>
            </div>
          )}
        </dl>
      </div>

      {page.description?.trim() && (
        // `whitespace-pre-line` porque a descrição é texto simples com quebras
        // de linha — a plataforma não tem editor rich text em lugar nenhum, e o
        // §10 do Prompt 2 pediu o formato existente.
        //
        // ⚠️ TEXTO, E NÃO `dangerouslySetInnerHTML` (§34). O que um
        // administrador digitar no Builder aparece como escreveu, e um `<script>`
        // digitado ali aparece como as letras `<script>`.
        <p className="text-base leading-relaxed whitespace-pre-line">{page.description}</p>
      )}

      {/* §12 e §28 — o aviso de vagas só aparece quando ele muda uma decisão.
          "Restam 180 de 200" no primeiro dia é ruído; "resta 1 vaga" na véspera
          é a informação mais importante da página. */}
      {vagas !== null && vagas > 0 && vagas <= 20 && (
        <p className="text-primary-strong text-center text-sm font-semibold">
          {PUBLIC_LANDING_COPY.seatsLeft(vagas)}
        </p>
      )}

      {/* §29 — o prazo, dito ANTES de a pessoa começar a preencher. Descobrir
          que as inscrições fecham hoje à noite depois de digitar cinco
          participantes é tarde demais para servir de alguma coisa. */}
      {page.closesAt && (
        <p className="text-muted-foreground text-center text-sm">
          {PUBLIC_LANDING_COPY.deadline(formatDateTime(page.closesAt))}
        </p>
      )}
    </article>
  );
}
