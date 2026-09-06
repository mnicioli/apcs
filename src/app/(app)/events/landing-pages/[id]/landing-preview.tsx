"use client";

import { useState } from "react";
import { Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import { ApcsMark } from "@/components/brand/apcs-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SignedImage } from "@/components/ui/signed-image";
import { cn, formatCalendarDate } from "@/lib/utils";
import {
  LANDING_FIELD_LABELS,
  LANDING_INSTITUTIONAL_CONTEXT,
} from "@/modules/event/event.landing.labels";
import {
  resolveSuccessMessage,
  type LandingTemplateEvent,
} from "@/modules/event/event.landing.rules";
import {
  CONTACT_LANDING_FIELD_KEYS,
  REQUIRED_LANDING_FIELD_KEYS,
  type LandingFieldKey,
  type LandingSuccessMessage,
} from "@/modules/event/event.landing.types";
import { formatTimeRange } from "@/modules/event/event.rules";

/**
 * A PRÉVIA DA PÁGINA PÚBLICA (§19, §20, §21).
 *
 * ============================================================================
 * ⚠️ ELA NÃO CRIA INSCRIÇÃO NENHUMA, E ISSO É ESTRUTURAL — NÃO UMA PROMESSA.
 * ============================================================================
 * O §34 é explícito: "O Preview pode simular visualmente o formulário, mas não
 * deve criar inscrições reais." Aqui isso não depende de ninguém lembrar: este
 * componente não importa nenhuma Server Action, nenhum cliente Supabase e
 * nenhum módulo `server-only`. Os campos são `disabled`, o botão de confirmar
 * não tem `onClick`, e o "adicionar participante" mexe num contador local.
 *
 * Não há o que enviar porque não há para onde enviar.
 *
 * ⚠️ TEMPO REAL SEM SALVAR (§19): este componente recebe o estado do Builder por
 * props. Nenhuma leitura, nenhum efeito, nenhum `useEffect` esperando dado —
 * digitar no campo ao lado redesenha esta coluna no mesmo quadro.
 *
 * ⚠️ A IDENTIDADE INSTITUCIONAL NÃO VEM DE PROP (§21). Logo, assinatura e cor
 * saem de `LANDING_INSTITUTIONAL_CONTEXT` e dos tokens do design system. Não há
 * caminho por onde o usuário mude isso, porque não existe campo para isso em
 * lugar nenhum — o §19 do Prompt 1 já tinha decidido que a identidade não seria
 * um DADO.
 */

type Dispositivo = "desktop" | "mobile";

export interface LandingPreviewState {
  description: string;
  formFields: LandingFieldKey[];
  successTitle: string;
  successMessage: string;
  successFooter: string;
  maxParticipants: string;
}

export function LandingPreview({
  state,
  event,
  imageUrl,
  successDefaults,
}: {
  state: LandingPreviewState;
  event: LandingTemplateEvent & { location: string };
  /** A arte própria da página, ou o cartaz do evento quando ela não tem uma. */
  imageUrl: string | null;
  /** O texto padrão da plataforma, para os campos que a página não sobrescreve. */
  successDefaults: LandingSuccessMessage;
}) {
  const [dispositivo, setDispositivo] = useState<Dispositivo>("desktop");
  /** Quantos participantes a simulação mostra. Contador local, e nada mais. */
  const [participantes, setParticipantes] = useState(1);
  const [mostrandoSucesso, setMostrandoSucesso] = useState(false);

  const sucesso = resolveSuccessMessage(
    {
      successTitle: state.successTitle.trim() || null,
      successMessage: state.successMessage.trim() || null,
      successFooter: state.successFooter.trim() || null,
    },
    successDefaults,
    event,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Prévia</h2>

        <div className="flex items-center gap-1">
          {/* §20. Não é uma moldura de aparelho — é a LARGURA, que é o que
              decide se a composição cabe. Um desenho de iPhone em volta não
              responderia nada que esta troca de largura não responda. */}
          <div
            role="group"
            aria-label="Largura da prévia"
            className="border-border flex rounded-md border p-0.5"
          >
            <BotaoDispositivo
              atual={dispositivo}
              valor="desktop"
              onSelect={setDispositivo}
              icone={<Monitor className="h-4 w-4" aria-hidden="true" />}
              rotulo="Computador"
            />
            <BotaoDispositivo
              atual={dispositivo}
              valor="mobile"
              onSelect={setDispositivo}
              icone={<Smartphone className="h-4 w-4" aria-hidden="true" />}
              rotulo="Celular"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={mostrandoSucesso}
            onClick={() => setMostrandoSucesso((atual) => !atual)}
          >
            {mostrandoSucesso ? "Ver formulário" : "Ver confirmação"}
          </Button>
        </div>
      </div>

      {/* O fundo escuro em volta separa a prévia da tela do CRM: sem ele, a
          pessoa não distingue o que é a página pública do que é o backoffice. */}
      <div className="bg-muted overflow-x-auto rounded-lg p-4">
        <div
          className={cn(
            "bg-card mx-auto overflow-hidden rounded-lg shadow-sm transition-all",
            dispositivo === "mobile" ? "w-[22rem] max-w-full" : "w-full",
          )}
        >
          <CabecalhoInstitucional />

          {mostrandoSucesso ? (
            <TelaDeSucesso mensagem={sucesso} />
          ) : (
            <div className="space-y-5 p-5">
              <SignedImage
                url={imageUrl}
                alt={`Imagem de ${event.name}`}
                sizes="w-full"
                className="h-auto max-h-72 rounded-md object-contain"
              />

              <div className="space-y-1 text-center">
                {/* §9. O título é o NOME DO EVENTO. Não há campo para
                    sobrescrevê-lo, e é a decisão do §9: mudar o título da página
                    não pode mudar o nome oficial do evento — e dois nomes para a
                    mesma coisa é como eles passam a divergir. */}
                <h3 className="text-primary-strong text-lg font-bold tracking-tight uppercase">
                  {event.name}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {formatCalendarDate(event.eventDate)} ·{" "}
                  {formatTimeRange(event.startTime, event.endTime)}
                </p>
                <p className="text-muted-foreground text-sm">{event.location}</p>
              </div>

              {state.description.trim() && (
                // `whitespace-pre-line` porque a descrição é texto simples com
                // quebras de linha — o §10 pede o formato que a plataforma já
                // usa, e ela não tem editor rich text em lugar nenhum.
                <p className="text-sm leading-relaxed whitespace-pre-line">{state.description}</p>
              )}

              <FormularioSimulado
                fields={state.formFields}
                participantes={participantes}
                onAdd={() => setParticipantes((n) => Math.min(n + 1, 5))}
                onRemove={() => setParticipantes((n) => Math.max(n - 1, 1))}
                capacidade={state.maxParticipants}
              />
            </div>
          )}

          <RodapeInstitucional />
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        A prévia é ilustrativa e não registra nada. O formulário de verdade entra no ar quando a
        página for publicada.
      </p>
    </div>
  );
}

function BotaoDispositivo({
  atual,
  valor,
  onSelect,
  icone,
  rotulo,
}: {
  atual: Dispositivo;
  valor: Dispositivo;
  onSelect: (valor: Dispositivo) => void;
  icone: React.ReactNode;
  rotulo: string;
}) {
  const ativo = atual === valor;
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={() => onSelect(valor)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
        ativo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {icone}
      {rotulo}
    </button>
  );
}

/**
 * §21 — APCS + CSPI, e o usuário não tira.
 *
 * ⚠️ O CSPI APARECE COMO ASSINATURA TIPOGRÁFICA, E NÃO COMO LOGO, PORQUE O
 * ARQUIVO NÃO EXISTE. `public/` tem `logo-apcs.svg` e mais nada. Desenhar um
 * substituto seria inventar a marca de terceiro; deixar um espaço vazio seria
 * fingir que está resolvido. A assinatura por extenso identifica os dois
 * enquanto o arquivo não chega, e trocá-la por uma imagem depois é mexer só
 * aqui. Ver docs/INSCRICOES.md.
 */
function CabecalhoInstitucional() {
  return (
    <div className="border-border flex items-center justify-between gap-3 border-b px-5 py-3">
      <ApcsMark height={24} />
      <span className="text-primary-strong text-xs font-semibold tracking-widest uppercase">
        {LANDING_INSTITUTIONAL_CONTEXT.program}
      </span>
    </div>
  );
}

function RodapeInstitucional() {
  return (
    <div className="border-border text-muted-foreground border-t px-5 py-3 text-center text-[11px]">
      {LANDING_INSTITUTIONAL_CONTEXT.signature}
    </div>
  );
}

/**
 * O formulário, simulado (§15).
 *
 * ⚠️ A GRANJA/EMPRESA APARECE UMA VEZ SÓ; O RESTO SE REPETE POR PARTICIPANTE.
 * É o modelo de dados aparecendo na tela: a inscrição é da granja, e as pessoas
 * pertencem a ela. Uma prévia que repetisse "Granja / Empresa" em cada
 * participante ensinaria o contrário e faria alguém desenhar o Prompt 3 errado.
 */
function FormularioSimulado({
  fields,
  participantes,
  onAdd,
  onRemove,
  capacidade,
}: {
  fields: LandingFieldKey[];
  participantes: number;
  onAdd: () => void;
  onRemove: () => void;
  capacidade: string;
}) {
  const daGranja = fields.filter((campo) => campo === "GRANJA_EMPRESA");
  const daPessoa = fields.filter((campo) => campo !== "GRANJA_EMPRESA");

  return (
    <div className="space-y-4">
      {capacidade.trim() && (
        <p className="text-muted-foreground text-center text-xs">
          Vagas limitadas: {capacidade.trim()} participantes.
        </p>
      )}

      {daGranja.map((campo) => (
        <CampoSimulado key={campo} campo={campo} />
      ))}

      {Array.from({ length: participantes }, (_, indice) => (
        <div key={indice} className="border-border space-y-4 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-wide uppercase">
              Participante {indice + 1}
            </p>
            {indice > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remover
              </Button>
            )}
          </div>

          {daPessoa.map((campo) => (
            <CampoSimulado key={campo} campo={campo} />
          ))}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="w-full" onClick={onAdd}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Adicionar participante
      </Button>

      {/*
        ⚠️ O CONSENTIMENTO ENTROU AQUI NA REVISÃO DO PROMPT 3 (§45.11: "o Preview
        representa corretamente a página real?"). A resposta era NÃO: a página
        pública passou a exigir o aceite de LGPD, e a prévia continuava mostrando
        um formulário sem ele. Um administrador conferiria a composição, aprovaria,
        publicaria — e a página no ar teria um campo obrigatório a mais que ele
        nunca viu.

        O TEXTO NÃO É CONFIGURÁVEL AQUI, e não é omissão: ele vem de
        `consent_texts`, que é editada em /settings/texts e vale para a plataforma
        inteira (§35). A prévia mostra que o bloco EXISTE, não qual é a redação —
        do mesmo jeito que mostra que há um campo de e-mail sem inventar um
        endereço.
      */}
      <div className="border-border flex items-start gap-2 rounded-md border border-dashed p-2.5">
        <div
          className="border-border bg-muted/40 mt-0.5 size-4 shrink-0 rounded border"
          aria-hidden="true"
        />
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          Aceite do tratamento de dados (LGPD). O texto é o da plataforma, editável em Configurações
          → Textos, e é obrigatório para concluir a inscrição.
        </p>
      </div>

      {/* ⚠️ SEM `onClick`. É o botão que a página pública terá, desenhado aqui
          para a composição ficar completa — e inerte, porque o §34 proíbe esta
          tela de criar inscrição. */}
      <div className="bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-center text-sm font-semibold tracking-wide uppercase">
        Confirmar inscrição
      </div>
    </div>
  );
}

function CampoSimulado({ campo }: { campo: LandingFieldKey }) {
  const obrigatorio = (REQUIRED_LANDING_FIELD_KEYS as readonly string[]).includes(campo);
  const contato = (CONTACT_LANDING_FIELD_KEYS as readonly string[]).includes(campo);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-wide uppercase">
        {LANDING_FIELD_LABELS[campo]}
        {obrigatorio && (
          <span className="text-destructive ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </p>
      {/* Uma caixa desenhada, e não um `<input disabled>`: um campo de
          formulário de verdade entra na ordem de tabulação e é lido por leitor
          de tela como algo preenchível — e não é. */}
      <div className="border-border bg-muted/40 h-9 rounded-md border" aria-hidden="true" />
      {contato && (
        <p className="text-muted-foreground text-[11px]">Informe telefone ou WhatsApp.</p>
      )}
    </div>
  );
}

/** §17. A tela que a pessoa vê depois de se inscrever. */
function TelaDeSucesso({ mensagem }: { mensagem: LandingSuccessMessage }) {
  return (
    <div className="space-y-3 p-8 text-center">
      <Badge variant="attention">Confirmação</Badge>
      <h3 className="text-primary-strong text-lg font-bold tracking-tight">{mensagem.title}</h3>
      <p className="text-sm whitespace-pre-line">{mensagem.message}</p>
      <p className="text-muted-foreground text-sm whitespace-pre-line">{mensagem.footer}</p>
    </div>
  );
}
