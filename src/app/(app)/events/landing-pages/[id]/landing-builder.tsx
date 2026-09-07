"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Save, TriangleAlert } from "lucide-react";
import { updateLandingPageAction } from "@/lib/actions/event-landing";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { fromLocalInput, toLocalInput } from "@/lib/time/local-input";
import {
  LANDING_PAGE_STATUS_HINTS,
  LANDING_PAGE_STATUS_LABELS,
  LANDING_PUBLISHED_EDIT_WARNING,
  LANDING_STATUS_REASON_LABELS,
} from "@/modules/event/event.landing.labels";
import {
  landingEffectiveStatus,
  landingStatusReason,
  slugPreview,
  slugWhileTyping,
  validateLandingFields,
  withEventDate,
} from "@/modules/event/event.landing.rules";
import { landingPageFormSchema } from "@/modules/event/event.landing.schema";
import type {
  LandingFieldKey,
  LandingPageWithEvent,
  LandingSuccessMessage,
} from "@/modules/event/event.landing.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateTimeSelect } from "@/components/ui/date-time-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LANDING_STATUS_BADGE_VARIANT } from "../landing-badges";
import { LandingStatusActions } from "../landing-status-actions";
import { LandingFieldList } from "./landing-field-list";
import { LandingImageField } from "./landing-image-field";
import { LandingPreview } from "./landing-preview";
import { LandingUrl } from "./landing-url";

/**
 * O BUILDER (§6 a §28).
 *
 * ============================================================================
 * ⚠️ QUATRO BLOCOS EMPILHADOS, CADA UM COM DUAS COLUNAS — E NÃO MAIS UMA
 *    COLUNA DE CONFIGURAÇÃO COM A PRÉVIA GRUDADA AO LADO.
 * ============================================================================
 * O desenho anterior era: tudo o que se configura à esquerda, numa lista
 * vertical longa, e a prévia à direita, `sticky`. Ele envelheceu mal por dois
 * motivos que se somaram.
 *
 * O primeiro: a coluna da esquerda tinha SEIS cartões, e três deles eram texto.
 * O cliente removeu o texto — descrição e mensagem de confirmação —, e o que
 * sobrou são pares que se leem juntos: o evento e o endereço dele; as duas
 * artes; os campos e as regras de inscrição. Empilhá-los numa coluna estreita
 * escondia justamente a relação entre eles.
 *
 * O segundo: a prévia deixou de ser uma tela e passou a ser DUAS (o formulário e
 * a confirmação). Duas páginas em miniatura não cabem numa coluna de metade da
 * tela, e a prévia parou de fazer sentido como coluna: virou o quarto bloco,
 * ocupando a largura inteira.
 *
 * ⚠️ A PRÉVIA DEIXOU DE SER `sticky`, E FOI DE PROPÓSITO. Ela acompanhava a
 * rolagem porque a configuração era uma coluna longa; com os blocos em duas
 * colunas a página encurtou pela metade, e uma prévia grudada no topo passaria a
 * cobrir o bloco que a pessoa está editando em vez de acompanhá-lo.
 *
 * ⚠️ NÃO HÁ AUTOSAVE, e o §28 diz para não inventar um: "Não implementar
 * autosave se isso não fizer parte do padrão da aplicação." O padrão desta
 * plataforma é salvar com botão, e a proteção contra perda é `beforeunload` —
 * a mesma de `event-form.tsx`, com o mesmo limite honesto (ele cobre fechar a
 * aba e recarregar; NÃO intercepta navegação interna do App Router, que não
 * expõe gancho para bloquear rota).
 *
 * ⚠️ AS IMAGENS SÃO A EXCEÇÃO, E ELAS SALVAM SOZINHAS. Um arquivo não cabe no
 * estado de um formulário que só vai ao servidor depois — ele precisa subir ao
 * Storage quando é escolhido. Por isso `LandingImageField` grava na hora e avisa
 * aqui para reler; e por isso as duas não entram na conta de "alterações não
 * salvas".
 */

type Estado = {
  slug: string;
  formFields: LandingFieldKey[];
  /** "AAAA-MM-DDTHH:MM" — hora local, que é o que o campo fala. */
  closesAt: string;
  maxParticipants: string;
};

function estadoInicial(page: LandingPageWithEvent): Estado {
  return {
    slug: page.slug,
    formFields: page.formFields,
    closesAt: toLocalInput(page.closesAt),
    maxParticipants: page.maxParticipants === null ? "" : String(page.maxParticipants),
  };
}

export function LandingBuilder({
  page,
  origin,
  successDefaults,
  canWrite,
}: {
  page: LandingPageWithEvent;
  origin: string;
  successDefaults: LandingSuccessMessage;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>(() => estadoInicial(page));
  const [salvo, setSalvo] = useState<Estado>(() => estadoInicial(page));
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const slugId = useId();
  const encerramentoId = useId();
  const capacidadeId = useId();

  const agora = useMemo(() => new Date(), []);
  const efetiva = landingEffectiveStatus(withEventDate(page), agora);
  const motivo = landingStatusReason(withEventDate(page), agora);

  const sujo = JSON.stringify(estado) !== JSON.stringify(salvo);
  const ocupado = isPending;

  /**
   * ⚠️ RESSINCRONIZA QUANDO O SERVIDOR MANDA DADO NOVO. Publicar, encerrar e
   * trocar qualquer uma das duas artes passam por `router.refresh()`: a página
   * volta com `status`, `slug`, `imageUrl` e `successImageUrl` novos. Sem isto,
   * o Builder continuaria mostrando o estado de antes de publicar — e o botão
   * "Publicar" seguiria na tela.
   *
   * ⚠️ E NÃO PISA NO QUE NÃO FOI SALVO. A comparação é contra `salvo`, não
   * contra `estado`: se o servidor traz o mesmo conteúdo que já estava gravado,
   * nada é tocado, e o que a pessoa está editando sobrevive ao refresh.
   */
  useEffect(() => {
    const doServidor = estadoInicial(page);
    setSalvo((anterior) =>
      JSON.stringify(anterior) === JSON.stringify(doServidor) ? anterior : doServidor,
    );
    setEstado((anterior) =>
      JSON.stringify(anterior) === JSON.stringify(salvo) ? doServidor : anterior,
    );
    // `salvo` de propósito fora das dependências: incluí-lo faria o efeito
    // rodar a cada gravação e desfazer a edição em curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // A mesma proteção de `event-form.tsx`. Ver o aviso do cabeçalho.
  useEffect(() => {
    if (!sujo || ocupado) return;

    function avisar(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo, ocupado]);

  function alterar<K extends keyof Estado>(campo: K, valor: Estado[K]) {
    setEstado((atual) => ({ ...atual, [campo]: valor }));
    setAviso(null);
  }

  const problemaDosCampos = validateLandingFields(estado.formFields);

  function salvar(): void {
    setErro(null);
    setAviso(null);

    // ⚠️ O MESMO SCHEMA DA ACTION. Rodá-lo aqui não é redundância: é o que
    // permite mostrar a mensagem no campo em vez de um "dados inválidos"
    // genérico depois da ida ao servidor. A action valida de novo, e é ela que
    // decide.
    const conferido = landingPageFormSchema.safeParse({
      ...estado,
      closesAt: fromLocalInput(estado.closesAt),
    });

    if (!conferido.success) {
      setErro(conferido.error.issues[0]?.message ?? ACTION_ERROR_MESSAGES.invalidInput);
      return;
    }

    startTransition(async () => {
      const resultado = await updateLandingPageAction({
        ...conferido.data,
        landingPageId: page.id,
      });

      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }

      // ⚠️ O SLUG PODE VOLTAR DIFERENTE DO QUE FOI ENVIADO. Quem decide é
      // `event_landing_free_slug` no Postgres, que resolve colisão com `-2`,
      // `-3`… Dizer isso na hora evita a pessoa descobrir depois que o endereço
      // que ela colou num WhatsApp não é o que está no ar.
      if (resultado.data.slug !== estado.slug) {
        setAviso(
          `O endereço ficou "${resultado.data.slug}" — o que você digitou já estava em uso.`,
        );
      }

      setSalvo(estado);
      router.refresh();
    });
  }

  const temInscritos = page.participantCount > 0;

  return (
    <div className="space-y-6">
      {/* -------------------------------------------------------------- §22 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Link
            href="/events/landing-pages"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Landing Pages
          </Link>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{page.event.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={LANDING_STATUS_BADGE_VARIANT[efetiva]}
              title={motivo ? LANDING_STATUS_REASON_LABELS[motivo] : undefined}
            >
              {LANDING_PAGE_STATUS_LABELS[efetiva]}
            </Badge>
            <span className="text-muted-foreground text-sm">
              {LANDING_PAGE_STATUS_HINTS[efetiva]}
            </span>
          </div>
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={salvar} disabled={ocupado || !sujo}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {ocupado ? "Salvando…" : sujo ? "Salvar" : "Salvo"}
            </Button>
            <LandingStatusActions
              landingPageId={page.id}
              eventName={page.event.name}
              status={page.status}
              size="default"
              onDone={() => router.refresh()}
            />
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- §25 e §29 */}
      {sujo && (
        <p role="status" className="text-muted-foreground text-sm">
          Há alterações não salvas.
        </p>
      )}

      {page.status === "published" && temInscritos && (
        <div className="border-border bg-muted/40 flex gap-3 rounded-lg border p-4">
          <TriangleAlert
            className="text-primary-strong mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <p className="text-sm">{LANDING_PUBLISHED_EDIT_WARNING}</p>
        </div>
      )}

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="text-muted-foreground text-sm">
          {aviso}
        </p>
      )}

      {/* ================================================================= 1
          O EVENTO E O ENDEREÇO DELE.

          Os dois juntos porque respondem à mesma pergunta — "que página é
          esta, e onde ela fica?" — e porque nenhum dos dois se edita muito:
          são o cabeçalho de identidade da tela. §32: duas colunas a partir de
          `lg`, empilhadas abaixo disso, porque em tablet as duas apertadas
          ficariam ilegíveis. */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------------------------------------------- §7, §9, §11 */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-sm font-medium">Evento</h2>
            {/* ⚠️ SÓ LEITURA, E É O §7 + O §9. Nome, data e local vêm do
                evento e continuam morando lá. Um campo editável aqui criaria
                um segundo nome para a mesma coisa — e o §9 é explícito: "A
                alteração do título da Landing Page não deve alterar o nome
                oficial do evento." A forma mais segura de garantir isso é não
                haver o que alterar. */}
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Nome</dt>
                <dd className="font-medium">{page.event.name}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Data e horário</dt>
                <dd className="tabular-nums">
                  {page.event.eventDate.split("-").reverse().join("/")} · {page.event.startTime}
                  {page.event.endTime ? ` às ${page.event.endTime}` : ""}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Local</dt>
                <dd>{page.event.location}</dd>
              </div>
            </dl>
            <Button asChild variant="outline" size="sm">
              <Link href={`/events/${page.eventId}/edit`}>Editar o evento</Link>
            </Button>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------ §27 */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <LandingUrl origin={origin} slug={page.slug} published={page.status === "published"} />

            <div className="space-y-2">
              <Label htmlFor={slugId}>Endereço personalizado</Label>
              {/* ⚠️ DUAS NORMALIZAÇÕES, E A DIFERENÇA É UM HÍFEN NO FIM.
                  Enquanto se digita, um hífen no fim é uma palavra que ainda
                  não terminou; cortá-lo a cada tecla tornava impossível
                  escrever um endereço de duas palavras. Ao sair do campo, ele
                  é lixo. Ver `slugWhileTyping` em event.landing.rules.ts. */}
              <Input
                id={slugId}
                value={estado.slug}
                disabled={!canWrite || ocupado}
                onChange={(event) => alterar("slug", slugWhileTyping(event.target.value))}
                onBlur={(event) => alterar("slug", slugPreview(event.target.value))}
                aria-describedby={`${slugId}-ajuda`}
              />
              <p id={`${slugId}-ajuda`} className="text-muted-foreground text-xs">
                Letras minúsculas, números e hífen. Se o endereço já estiver em uso, o sistema
                acrescenta um número ao final.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================================================================= 2
          AS DUAS ARTES, LADO A LADO (§8 e o banner de confirmação).

          ⚠️ ELAS FICAM JUNTAS PORQUE SÃO A PÁGINA INTEIRA AGORA. Depois que a
          descrição e a mensagem de confirmação saíram, o que a granja lê nesta
          landing page são estas duas imagens e mais nada. Pô-las lado a lado é
          o que permite ver se as duas conversam — mesma paleta, mesma marca,
          mesma linguagem —, que é a única conferência que restou. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <LandingImageField
              landingPageId={page.id}
              slot="page"
              imageUrl={page.imageUrl}
              fallbackUrl={page.event.imageUrl}
              eventName={page.event.name}
              disabled={!canWrite}
              onSaved={() => router.refresh()}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <LandingImageField
              landingPageId={page.id}
              slot="success"
              imageUrl={page.successImageUrl}
              eventName={page.event.name}
              disabled={!canWrite}
              onSaved={() => router.refresh()}
            />
          </CardContent>
        </Card>
      </div>

      {/* ================================================================= 3
          O QUE A PESSOA PREENCHE, E SOB QUE REGRAS.

          §12, §13, §14 à esquerda; §16 à direita. Os dois juntos porque a
          capacidade e o prazo só significam alguma coisa em relação ao
          formulário que está ao lado. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-5">
            <LandingFieldList
              fields={estado.formFields}
              onChange={(campos) => alterar("formFields", campos)}
              disabled={!canWrite || ocupado}
            />
            {problemaDosCampos && (
              <p role="alert" className="text-destructive text-sm">
                A configuração atual não pode ser salva. Granja/Empresa, E-mail e Nome do
                Participante são obrigatórios, e é preciso ter Telefone ou WhatsApp.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------ §16 */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-sm font-medium">Configurações de inscrição</h2>

            <div className="space-y-2">
              <Label htmlFor={encerramentoId}>Encerramento das inscrições</Label>
              <DateTimeSelect
                id={encerramentoId}
                label="Encerramento das inscrições"
                value={estado.closesAt}
                disabled={!canWrite || ocupado}
                onChange={(valor) => alterar("closesAt", valor)}
              />
              <p className="text-muted-foreground text-xs">
                Em branco significa sem prazo. O padrão é o início do evento.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={capacidadeId}>Capacidade máxima</Label>
              <Input
                id={capacidadeId}
                inputMode="numeric"
                value={estado.maxParticipants}
                disabled={!canWrite || ocupado}
                placeholder="Sem limite"
                onChange={(event) =>
                  // Só dígitos entram: o schema recusaria "100 pessoas", e
                  // deixar digitar para recusar depois é pior do que não
                  // deixar digitar.
                  alterar("maxParticipants", event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                aria-describedby={`${capacidadeId}-ajuda`}
              />
              <p id={`${capacidadeId}-ajuda`} className="text-muted-foreground text-xs">
                Em branco significa ilimitado. O limite conta PARTICIPANTES, não inscrições — hoje
                há {page.participantCount}.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================================================================= 4
          A PRÉVIA — §19, §20, §21.

          Largura inteira, e as duas telas em duas colunas por dentro. Ver o
          cabeçalho deste arquivo para o porquê de ela ter deixado de ser uma
          coluna `sticky`. */}
      <Card>
        <CardContent className="p-5">
          <LandingPreview
            state={{
              formFields: estado.formFields,
              maxParticipants: estado.maxParticipants,
            }}
            event={{
              name: page.event.name,
              eventDate: page.event.eventDate,
              startTime: page.event.startTime,
              endTime: page.event.endTime,
              location: page.event.location,
            }}
            imageUrl={page.imageUrl ?? page.event.imageUrl}
            successImageUrl={page.successImageUrl}
            successDefaults={successDefaults}
          />
        </CardContent>
      </Card>
    </div>
  );
}
