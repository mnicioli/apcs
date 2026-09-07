import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
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
 * ⚠️ A DESCRIÇÃO ERA EDITÁVEL E DEIXOU DE SER. A frase de prévia saía do texto
 * que o Builder oferecia; ele foi removido junto com o resto do texto solto da
 * página, e o que sobrou é a frase montada a partir do EVENTO. Não é perda: a
 * anterior só existia quando alguém tinha lembrado de escrevê-la, e caía nesta
 * mesma frase quando não.
 *
 * ⚠️ NENHUM DADO PESSOAL AQUI, e nenhuma informação interna do evento: nome e
 * data, e mais nada. A imagem NÃO entra no Open Graph, e a ausência é
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
  const descricao = `Inscrições para ${page.event.name}, em ${formatCalendarDate(page.event.eventDate)}.`;

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
        {/* Fora do formulário de propósito: é o que dá nome à página em TODOS
            os estados, inclusive no de confirmação. Ver `IdentidadeDoEvento`. */}
        <IdentidadeDoEvento page={page} />

        {/*
          ⚠️ CAMPO A CAMPO, E NÃO `page={page}` (§33). O formulário é um Client
          Component: tudo o que descer por esta prop é serializado no payload
          do RSC e chega ao navegador. A página inteira carrega a contagem de
          inscritos, a capacidade, o prazo e a situação — nada disso é
          desenhado ali, e "não é usado" não é o mesmo que "não foi enviado".

          Escrever os campos à mão é o que faz um acréscimo futuro à leitura
          pública precisar de uma DECISÃO para chegar ao navegador, em vez de
          chegar por distração.

          ⚠️ E `arte` NÃO ABRE UMA EXCEÇÃO A ISSO. Ela desce como NÓ PRONTO,
          desenhado aqui no servidor — não como os dados para desenhá-lo. O
          formulário decide se aquilo continua na tela (some na confirmação) sem
          nunca receber `imageUrl`, `closesAt` ou a contagem de inscritos.
        */}
        <RegistrationForm
          page={{
            slug: page.slug,
            formFields: page.formFields,
            successImageUrl: page.successImageUrl,
            successDefaults: page.successDefaults,
            event: page.event,
            consent: page.consent,
          }}
          initialState={estadoInicial}
          arte={<ArteDoEvento page={page} />}
        />
      </main>

      <RodapeInstitucional />
    </>
  );
}

/**
 * §8 — o nome, a data, a hora e o local, SÓ PARA LEITOR DE TELA.
 *
 * ============================================================================
 * ⚠️ NOME, DATA, HORA E LOCAL SAÍRAM DA TELA — MAS NÃO DA PÁGINA.
 * ============================================================================
 * O pedido foi direto: essas quatro informações passam a viver no BANNER, e
 * repeti-las embaixo dele era dizer a mesma coisa duas vezes. Visualmente elas
 * sumiram mesmo: o `<h1>` vermelho e a lista com os três ícones não são mais
 * desenhados.
 *
 * O que continua é a versão em `sr-only` — presente no HTML, invisível na tela.
 * E isso não é teimosia com o pedido; é o pedido inteiro:
 *
 *   * o banner é uma IMAGEM. Quem usa leitor de tela recebe o `alt` dela e mais
 *     nada. Apagar o texto de vez tiraria data, hora e local de quem não
 *     enxerga — a informação não estaria "no banner" para essa pessoa, estaria
 *     em lugar nenhum;
 *   * imagem que não carrega acontece (rede ruim, URL assinada expirada), e sem
 *     isto a página viraria um formulário sem dizer para qual evento;
 *   * uma página sem `<h1>` não tem nome: o buscador e o índice de cabeçalhos
 *     do leitor de tela ficam sem por onde começar.
 *
 * Se a intenção for apagar mesmo, é uma linha — mas é uma decisão diferente
 * desta, e merece ser tomada sabendo o que se perde.
 *
 * ⚠️ NADA DE INTERNO CHEGA AQUI porque nada de interno chegou ao servidor:
 * `PublicLandingPage` simplesmente não tem `eventId`, autores, segmentação nem
 * `registration_url`. Ver o cabeçalho de `get_public_event_landing_page`.
 */
function IdentidadeDoEvento({ page }: { page: PublicLandingPage }) {
  return (
    /*
      ⚠️ ELA VIVE FORA DA ARTE, E FOI POR CAUSA DA TELA DE CONFIRMAÇÃO. Era um
      bloco dentro do mesmo `<article>` da imagem; quando a confirmação passou a
      substituir a arte inteira, este bloco iria junto — e a página de
      confirmação ficaria SEM `<h1>`, ou seja, sem nome para o índice de
      cabeçalhos do leitor de tela e para o buscador.

      Aqui ele sobrevive à troca. Custa zero pixel em qualquer estado.
    */
    <div className="sr-only">
      <h1>{page.event.name}</h1>
      <dl>
        <dt>Data</dt>
        <dd>{formatCalendarDate(page.event.eventDate)}</dd>
        <dt>Horário</dt>
        <dd>{formatTimeRange(page.event.startTime, page.event.endTime)}</dd>
        {page.event.location && (
          <>
            <dt>Local</dt>
            <dd>{page.event.location}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * A ARTE DO EVENTO, O AVISO DE VAGAS E O PRAZO — o que a confirmação apaga.
 *
 * ⚠️ ELA DESCE COMO PROP PARA O FORMULÁRIO, e não é desenhada aqui na página
 * como antes. O motivo é o defeito que isto veio consertar: a confirmação
 * substituía só o formulário, e este bloco continuava desenhado ACIMA dela —
 * dois banners empilhados e um "Inscrições até 18/09/2026" logo depois de a
 * pessoa ter se inscrito.
 *
 * Continua sendo o SERVIDOR quem desenha. O que o cliente ganhou foi a decisão
 * de mostrar ou não; os dados para montar isto — `imageUrl`, `closesAt`,
 * `maxParticipants`, `participantCount` — continuam sem atravessar a fronteira.
 */
function ArteDoEvento({ page }: { page: PublicLandingPage }) {
  const vagas =
    page.maxParticipants === null
      ? null
      : Math.max(page.maxParticipants - page.participantCount, 0);

  return (
    <article>
      <div className="space-y-5">
        {page.imageUrl && (
          <SignedImage
            url={page.imageUrl}
            alt={`Imagem de ${page.event.name}`}
            sizes="w-full"
            className="h-auto w-full rounded-2xl object-contain"
          />
        )}

        {/*
          ⚠️ A DESCRIÇÃO SAIU DAQUI, e não é a mesma decisão de nome/data/local.
          Aqueles continuam no HTML em `sr-only` porque o BANNER passou a
          carregá-los e alguém que não enxerga precisa recebê-los de algum
          lugar. A descrição não foi movida para lugar nenhum: o cliente pediu
          a página sem texto solto, e a arte é que diz o que precisa ser dito.

          Guardá-la em `sr-only` seria inventar uma versão da página que só
          quem usa leitor de tela lê — o oposto do que aquele bloco faz.
        */}

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
      </div>
    </article>
  );
}
