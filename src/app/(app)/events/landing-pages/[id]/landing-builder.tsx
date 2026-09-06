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
  LANDING_TEMPLATE_VARIABLE_LABELS,
} from "@/modules/event/event.landing.labels";
import {
  landingEffectiveStatus,
  landingStatusReason,
  LANDING_TEMPLATE_VARIABLES,
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
import { Textarea } from "@/components/ui/textarea";
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
 * ⚠️ CONFIGURAÇÃO À ESQUERDA, PRÉVIA À DIREITA — E A PRÉVIA NÃO SALVA NADA.
 * ============================================================================
 * Todo o estado do formulário mora AQUI, num `useState` só, e desce para as
 * duas colunas por props. É isso que faz o §19 (prévia em tempo real) ser
 * consequência do desenho em vez de um recurso: digitar redesenha a coluna da
 * direita no mesmo quadro, porque as duas leem o mesmo objeto.
 *
 * ⚠️ NÃO HÁ AUTOSAVE, e o §28 diz para não inventar um: "Não implementar
 * autosave se isso não fizer parte do padrão da aplicação." O padrão desta
 * plataforma é salvar com botão, e a proteção contra perda é `beforeunload` —
 * a mesma de `event-form.tsx`, com o mesmo limite honesto (ele cobre fechar a
 * aba e recarregar; NÃO intercepta navegação interna do App Router, que não
 * expõe gancho para bloquear rota).
 *
 * ⚠️ A IMAGEM É A EXCEÇÃO, E ELA SALVA SOZINHA. Um arquivo não cabe no estado
 * de um formulário que só vai ao servidor depois — ele precisa subir ao Storage
 * quando é escolhido. Por isso `LandingImageField` grava na hora e avisa aqui
 * para reler; e por isso ela não entra na conta de "alterações não salvas".
 */

type Estado = {
  slug: string;
  description: string;
  formFields: LandingFieldKey[];
  successTitle: string;
  successMessage: string;
  successFooter: string;
  /** "AAAA-MM-DDTHH:MM" — hora local, que é o que o campo fala. */
  closesAt: string;
  maxParticipants: string;
};

function estadoInicial(page: LandingPageWithEvent): Estado {
  return {
    slug: page.slug,
    description: page.description ?? "",
    formFields: page.formFields,
    successTitle: page.successTitle ?? "",
    successMessage: page.successMessage ?? "",
    successFooter: page.successFooter ?? "",
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
  const descricaoId = useId();
  const encerramentoId = useId();
  const capacidadeId = useId();
  const tituloId = useId();
  const mensagemId = useId();
  const rodapeId = useId();

  const agora = useMemo(() => new Date(), []);
  const efetiva = landingEffectiveStatus(withEventDate(page), agora);
  const motivo = landingStatusReason(withEventDate(page), agora);

  const sujo = JSON.stringify(estado) !== JSON.stringify(salvo);
  const ocupado = isPending;

  /**
   * ⚠️ RESSINCRONIZA QUANDO O SERVIDOR MANDA DADO NOVO. Publicar, encerrar e
   * trocar a imagem passam por `router.refresh()`: a página volta com `status`,
   * `slug` e `imageUrl` novos. Sem isto, o Builder continuaria mostrando o
   * estado de antes de publicar — e o botão "Publicar" seguiria na tela.
   *
   * ⚠️ E NÃO PISA NO QUE NÃO FOI SALVO. A comparação é contra `salvo`, não
   * contra `estado`: se o servidor traz o mesmo conteúdo que já estava gravado,
   * nada é tocado, e o texto que a pessoa está digitando sobrevive ao refresh.
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

      {/* -------------------------------------------------------------- §32
          Duas colunas a partir de `lg`; empilhadas abaixo disso. Em tablet as
          duas apertadas ficariam ilegíveis, e a ordem empilhada — configuração
          e depois prévia — é a que o §32 pede. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* ------------------------------------------------- §7, §9, §11 */}
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

          {/* --------------------------------------------------------- §27 */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <LandingUrl
                origin={origin}
                slug={page.slug}
                published={page.status === "published"}
              />

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

          {/* ----------------------------------------------------- §8 e §10 */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <LandingImageField
                landingPageId={page.id}
                imageUrl={page.imageUrl}
                eventImageUrl={page.event.imageUrl}
                eventName={page.event.name}
                disabled={!canWrite}
                onSaved={() => router.refresh()}
              />

              <div className="space-y-2">
                <Label htmlFor={descricaoId}>Descrição</Label>
                <Textarea
                  id={descricaoId}
                  rows={5}
                  maxLength={4000}
                  value={estado.description}
                  disabled={!canWrite || ocupado}
                  placeholder="O que a pessoa precisa saber para decidir ir."
                  onChange={(event) => alterar("description", event.target.value)}
                  aria-describedby={`${descricaoId}-ajuda`}
                />
                <p id={`${descricaoId}-ajuda`} className="text-muted-foreground text-xs">
                  Texto simples. As quebras de linha aparecem na página como você as digitar.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ------------------------------------------------- §12, §13, §14 */}
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

          {/* --------------------------------------------------------- §16 */}
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

          {/* ---------------------------------------------------- §17 e §18 */}
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-sm font-medium">Mensagem após a inscrição</h2>
                <p className="text-muted-foreground text-xs">
                  Deixe em branco para usar o texto padrão da APCS, configurável em Configurações →
                  Textos.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor={tituloId}>Título</Label>
                <Input
                  id={tituloId}
                  value={estado.successTitle}
                  maxLength={160}
                  disabled={!canWrite || ocupado}
                  placeholder={successDefaults.title}
                  onChange={(event) => alterar("successTitle", event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={mensagemId}>Mensagem</Label>
                <Textarea
                  id={mensagemId}
                  rows={3}
                  maxLength={1000}
                  value={estado.successMessage}
                  disabled={!canWrite || ocupado}
                  placeholder={successDefaults.message}
                  onChange={(event) => alterar("successMessage", event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={rodapeId}>Mensagem final</Label>
                <Input
                  id={rodapeId}
                  value={estado.successFooter}
                  maxLength={300}
                  disabled={!canWrite || ocupado}
                  placeholder={successDefaults.footer}
                  onChange={(event) => alterar("successFooter", event.target.value)}
                />
              </div>

              {/* ⚠️ A LISTA APARECE NA TELA porque o §18 proíbe variável
                  arbitrária — e a única forma de isso não virar tentativa e erro
                  é MOSTRAR quais existem, ao lado do campo em que se digita. */}
              <div className="space-y-1">
                <p className="text-xs font-medium">Variáveis disponíveis</p>
                <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {LANDING_TEMPLATE_VARIABLES.map((variavel) => (
                    <li key={variavel}>
                      <code>{`{{${variavel}}}`}</code> —{" "}
                      {LANDING_TEMPLATE_VARIABLE_LABELS[variavel]}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* --------------------------------------------------- §19, §20, §21
            `lg:sticky` mantém a prévia visível enquanto se rola a coluna de
            configuração — que é longa. Sem isso, mexer na mensagem de sucesso
            (o último cartão) deixaria a prévia fora da tela, e a alteração em
            tempo real não seria vista por ninguém. */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <LandingPreview
            state={{
              description: estado.description,
              formFields: estado.formFields,
              successTitle: estado.successTitle,
              successMessage: estado.successMessage,
              successFooter: estado.successFooter,
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
            successDefaults={successDefaults}
          />
        </div>
      </div>
    </div>
  );
}
