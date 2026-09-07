"use client";

import { useState } from "react";
import { Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import { ApcsMark } from "@/components/brand/apcs-logo";
import { CspiMark } from "@/components/brand/cspi-logo";
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
 * ============================================================================
 * ⚠️ AS DUAS TELAS APARECEM AO MESMO TEMPO, LADO A LADO.
 * ============================================================================
 * Era um botão que alternava entre "Ver formulário" e "Ver confirmação" — uma
 * tela de cada vez. Passaram a ser duas colunas, e a razão é o que a página se
 * tornou: as duas telas agora são, principalmente, DUAS ARTES. Comparar duas
 * imagens é a operação que se faz o tempo todo aqui, e um botão que troca uma
 * pela outra transforma comparação em memória.
 *
 * ⚠️ TEMPO REAL SEM SALVAR (§19): este componente recebe o estado do Builder por
 * props. Nenhuma leitura, nenhum efeito, nenhum `useEffect` esperando dado —
 * mexer no campo ao lado redesenha esta área no mesmo quadro.
 *
 * ⚠️ A IDENTIDADE INSTITUCIONAL NÃO VEM DE PROP (§21). Logo, assinatura e cor
 * saem de `LANDING_INSTITUTIONAL_CONTEXT` e dos tokens do design system. Não há
 * caminho por onde o usuário mude isso, porque não existe campo para isso em
 * lugar nenhum — o §19 do Prompt 1 já tinha decidido que a identidade não seria
 * um DADO.
 */

type Dispositivo = "desktop" | "mobile";

export interface LandingPreviewState {
  formFields: LandingFieldKey[];
  maxParticipants: string;
}

export function LandingPreview({
  state,
  event,
  imageUrl,
  successImageUrl,
  successDefaults,
}: {
  state: LandingPreviewState;
  event: LandingTemplateEvent & { location: string };
  /** A arte própria da página, ou o cartaz do evento quando ela não tem uma. */
  imageUrl: string | null;
  /** O banner de confirmação. `null` = a confirmação usa o texto padrão. */
  successImageUrl: string | null;
  /** O texto padrão da plataforma — hoje, o ÚNICO texto da confirmação. */
  successDefaults: LandingSuccessMessage;
}) {
  const [dispositivo, setDispositivo] = useState<Dispositivo>("desktop");
  /** Quantos participantes a simulação mostra. Contador local, e nada mais. */
  const [participantes, setParticipantes] = useState(1);

  const sucesso = resolveSuccessMessage(successDefaults, event);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Prévia</h2>
          <p className="text-muted-foreground text-xs">
            É ilustrativa e não registra nada. O formulário de verdade entra no ar quando a página
            for publicada.
          </p>
        </div>

        {/* §20. Não é uma moldura de aparelho — é a LARGURA, que é o que
            decide se a composição cabe. Um desenho de iPhone em volta não
            responderia nada que esta troca de largura não responda.

            ⚠️ UM CONTROLE PARA AS DUAS COLUNAS. Larguras diferentes nas duas
            telas fariam a comparação mentir sobre qual arte fica melhor. */}
        <div
          role="group"
          aria-label="Largura da prévia"
          className="border-border flex shrink-0 rounded-md border p-0.5"
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
      </div>

      {/* Duas colunas a partir de `xl`, e não de `lg`: cada painel é uma página
          inteira em miniatura, e espremer duas num tablet torna as duas
          ilegíveis — que é o oposto do que uma prévia serve para fazer. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Painel titulo="Ver formulário" dispositivo={dispositivo}>
          <div className="space-y-5 p-5">
            <SignedImage
              url={imageUrl}
              alt={`Imagem de ${event.name}`}
              sizes="w-full"
              className="h-auto max-h-72 rounded-md object-contain"
            />

            {/*
              ⚠️ NOME, DATA, HORA E LOCAL SAÍRAM DAQUI PORQUE SAÍRAM DE LÁ.
              Eles passaram a viver no banner, e a página pública deixou de
              desenhá-los. Esta prévia existe para mostrar o que vai ao ar: se
              ela continuasse exibindo o título vermelho e a linha de data e
              local, o administrador aprovaria uma composição que ninguém
              nunca veria.

              A descrição saiu na mesma leva, e pelo mesmo motivo: a página
              pública não a desenha mais.

              É a mesma lição do consentimento, ali embaixo — uma prévia que
              não acompanha a página real não é ilustrativa, é errada. E o
              jeito de o banner ficar bom é justamente conferi-lo aqui SEM o
              texto por baixo, porque é assim que ele chega a quem se inscreve.
            */}
            <FormularioSimulado
              fields={state.formFields}
              participantes={participantes}
              onAdd={() => setParticipantes((n) => Math.min(n + 1, 5))}
              onRemove={() => setParticipantes((n) => Math.max(n - 1, 1))}
              capacidade={state.maxParticipants}
            />
          </div>
        </Painel>

        <Painel titulo="Ver confirmação" dispositivo={dispositivo}>
          <TelaDeSucesso mensagem={sucesso} event={event} imageUrl={successImageUrl} />
        </Painel>
      </div>
    </div>
  );
}

/**
 * Uma das duas telas, com o cabeçalho e o rodapé institucionais em volta.
 *
 * ⚠️ O TÍTULO É UM CABEÇALHO DE VERDADE, e não um rótulo desenhado. As duas
 * colunas mostram páginas parecidas — mesma marca no topo, mesmo rodapé —, e sem
 * um cabeçalho por painel quem usa leitor de tela recebe as duas em sequência
 * sem saber onde uma termina e a outra começa.
 */
function Painel({
  titulo,
  dispositivo,
  children,
}: {
  titulo: string;
  dispositivo: Dispositivo;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {titulo}
      </h3>

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
          {children}
          <RodapeInstitucional />
        </div>
      </div>
    </section>
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
 * §21 — APCS + CSP, e o usuário não tira.
 *
 * ⚠️ O QUE ESTÁ AQUI TEM DE SER O QUE A PÁGINA PÚBLICA MOSTRA — é o ponto de
 * existir uma prévia. Quando o CSP deixou de ser a palavra "CSPI" e virou
 * desenho lá, virou desenho aqui na MESMA mudança. A altura é menor porque
 * este cabeçalho inteiro é menor (24 contra 32).
 */
function CabecalhoInstitucional() {
  return (
    <div className="border-border flex items-center justify-between gap-3 border-b px-5 py-3">
      <ApcsMark height={24} />
      <CspiMark height={20} />
    </div>
  );
}

function RodapeInstitucional() {
  return (
    <div className="border-border text-muted-foreground border-t px-5 py-3 text-center text-[11px]">
      {LANDING_INSTITUTIONAL_CONTEXT.copyright}
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

/**
 * §17. A tela que a pessoa vê depois de se inscrever.
 *
 * ============================================================================
 * ⚠️ COM BANNER, A TELA É SÓ O BANNER — E A PRÉVIA TEM DE SER SÓ ELE TAMBÉM.
 * ============================================================================
 * A página pública esconde tudo em `sr-only` quando há banner: título,
 * mensagem, data, horário e rodapé. Foi um pedido explícito — "apresentar ao
 * usuário final apenas o banner de confirmação" —, e o custo dele (a data passa
 * a depender da arte) está registrado no cabeçalho de `TelaDeSucesso` em
 * `registration-form.tsx`.
 *
 * Se esta prévia mostrasse a arte E qualquer linha de texto, o administrador
 * aprovaria uma composição que ninguém vê — que é exatamente o defeito que o
 * §45.11 pegou no consentimento, por outra porta. E é aqui, sem nada por baixo,
 * que dá para julgar se a arte está dizendo tudo o que precisa dizer: se falta
 * a data no banner, é NESTA coluna que isso salta aos olhos.
 */
function TelaDeSucesso({
  mensagem,
  event,
  imageUrl,
}: {
  mensagem: LandingSuccessMessage;
  event: LandingTemplateEvent;
  imageUrl: string | null;
}) {
  if (imageUrl) {
    return (
      <SignedImage
        url={imageUrl}
        alt={`Confirmação de ${event.name}`}
        sizes="w-full"
        className="h-auto w-full rounded-none object-contain"
      />
    );
  }

  return (
    <div className="space-y-3 p-8 text-center">
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground mx-auto flex size-10 items-center justify-center rounded-full text-lg"
      >
        ✓
      </span>
      <h4 className="text-primary-strong text-lg font-bold tracking-tight">{mensagem.title}</h4>
      <p className="text-sm whitespace-pre-line">{mensagem.message}</p>

      <p className="text-foreground pt-1 text-sm font-semibold">
        {formatCalendarDate(event.eventDate)}
      </p>
      <p className="text-muted-foreground text-xs">
        {formatTimeRange(event.startTime, event.endTime)}
      </p>

      <p className="text-muted-foreground text-sm whitespace-pre-line">{mensagem.footer}</p>
    </div>
  );
}
