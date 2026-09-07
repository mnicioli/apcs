"use client";

import { useCallback, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CheckboxRow, TextField } from "@/components/public/fields";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { submitEventRegistrationAction } from "@/lib/actions/event-registration-public";
import { formatPhoneInput } from "@/lib/format/phone";
import { formatCalendarDate } from "@/lib/utils";
import { LANDING_FIELD_LABELS, PUBLIC_LANDING_COPY } from "@/modules/event/event.landing.labels";
import {
  publicRegistrationSchema,
  type ParticipantInput,
} from "@/modules/event/event.landing.schema";
import { resolveSuccessMessage } from "@/modules/event/event.landing.rules";
import {
  MAX_PARTICIPANTS_PER_REGISTRATION,
  type LandingFieldKey,
  type PublicRegistrationFormData,
  type PublicRegistrationState,
} from "@/modules/event/event.landing.types";
import { formatTimeRange } from "@/modules/event/event.rules";
import { AvisoInscricoesFechadas } from "./landing-chrome";

/**
 * O FORMULÁRIO PÚBLICO DE INSCRIÇÃO — a inscrição de uma granja, com um ou
 * vários participantes.
 *
 * ============================================================================
 * ⚠️ AS DECISÕES QUE PARECEM DETALHE E NÃO SÃO
 * ============================================================================
 *
 * 1. UM `useState` SÓ, E NÃO REACT HOOK FORM. É a mesma exceção consciente de
 *    `membership-form.tsx` (ver CLAUDE.md): o número de campos MUDA em tempo de
 *    execução — cada "adicionar participante" cria quatro campos novos, e quais
 *    deles existem depende de `formFields`, que o Builder configurou. Um
 *    `resolver` com array dinâmico e schema condicional é mais máquina do que
 *    um objeto e um `safeParse`. O schema É o mesmo do servidor.
 *
 * 2. `submittingRef` E NÃO `state === "submitting"` NO GUARDA DE ENVIO DUPLO
 *    (§23). `setState` é assíncrono: dois cliques rápidos passam os dois pelo
 *    `if` antes do primeiro `render`. O `ref` muda na hora. E ele é a PRIMEIRA
 *    das três redes — a segunda é o botão `disabled`, a terceira é a chave de
 *    deduplicação no banco, que é a única que sobrevive a um F5 no meio do
 *    envio.
 *
 * 3. O E-MAIL NÃO É REESCRITO ENQUANTO SE DIGITA (§16). "Joao@Email.com" e
 *    "joao@email.com" são a mesma pessoa para a duplicidade — e quem decide
 *    isso é o `toLowerCase()` do schema e o `lower()` do Postgres, na
 *    comparação. Baixar a caixa no `onChange` mudaria O QUE A PESSOA ESTÁ
 *    VENDO por uma necessidade que é do banco, não dela.
 *
 * 4. AS LINHAS TÊM `key` PRÓPRIA, e não o índice. Remover o participante 2 com
 *    `key={indice}` faria o React reaproveitar o DOM da linha 3 na posição 2 —
 *    o texto certo aparece, mas o foco, o estado de erro e o que o leitor de
 *    tela já anunciou ficam na linha errada. É o defeito clássico de lista
 *    editável, e ele só aparece depois de remover.
 *
 * 5. A ORDEM E A PRESENÇA DOS CAMPOS VÊM DE `formFields`. É o §12 do Prompt 2
 *    chegando aqui: o que o Builder arrastou é o que esta página desenha. Nada
 *    é decidido neste arquivo.
 */

/** Uma linha do formulário: um participante mais a identidade dela no React. */
type Linha = ParticipantInput & { key: string };

type Erros = Record<string, string | undefined>;

let proximaChave = 0;
function novaLinha(): Linha {
  proximaChave += 1;
  return { key: `p${proximaChave}`, fullName: "", email: "", phone: "", whatsapp: "" };
}

export function RegistrationForm({
  page,
  initialState,
}: {
  page: PublicRegistrationFormData;
  /**
   * O que o SERVIDOR concluiu ao carregar a página (§29). `closed` e `soldOut`
   * chegam prontos daqui — a tela nunca calcula sozinha se as inscrições estão
   * abertas.
   */
  initialState: PublicRegistrationState;
}) {
  const [companyName, setCompanyName] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>(() => [novaLinha()]);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [erros, setErros] = useState<Erros>({});
  const [estado, setEstado] = useState<PublicRegistrationState>(initialState);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  const enviandoRef = useRef(false);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  const mostraCampo = useCallback(
    (campo: LandingFieldKey) => page.formFields.includes(campo),
    [page.formFields],
  );

  const setLinha = (indice: number, campo: keyof ParticipantInput, valor: string) => {
    setLinhas((atual) =>
      atual.map((linha, i) => (i === indice ? { ...linha, [campo]: valor } : linha)),
    );
    // O erro do campo some assim que a pessoa mexe nele: manter a mensagem
    // vermelha enquanto ela corrige é dizer que está errado o que ela está
    // justamente consertando.
    setErros((atual) => ({
      ...atual,
      [`participants.${indice}.${campo}`]: undefined,
      // O erro de "telefone ou WhatsApp" mora no campo de telefone, mas é
      // resolvido por qualquer um dos dois. Sem esta linha, preencher o
      // WhatsApp deixaria a mensagem vermelha no telefone.
      ...(campo === "whatsapp" ? { [`participants.${indice}.phone`]: undefined } : {}),
    }));
  };

  const adicionar = () => {
    setLinhas((atual) =>
      atual.length >= MAX_PARTICIPANTS_PER_REGISTRATION ? atual : [...atual, novaLinha()],
    );
  };

  /**
   * §14 — remover qualquer participante, desde que sobre um.
   *
   * ⚠️ QUALQUER UM, INCLUSIVE O PRIMEIRO. O §14 só proíbe a remoção que deixaria
   * a inscrição sem ninguém; travar a primeira linha por ela ser a primeira
   * obrigaria quem errou o nome do participante 1 a apagar campo por campo.
   */
  const remover = (indice: number) => {
    setLinhas((atual) => (atual.length <= 1 ? atual : atual.filter((_, i) => i !== indice)));
    // Os erros são indexados por POSIÇÃO: depois de remover, o erro do índice 2
    // passaria a apontar para outra pessoa. Limpar tudo é a única resposta
    // certa, e o próximo envio recalcula.
    setErros({});
  };

  /** Leva o foco ao primeiro campo com erro — sem isso, a pessoa vê o botão
   *  recusar e não descobre onde está o problema. */
  const focarPrimeiroErro = (lista: Erros) => {
    const primeiro = Object.keys(lista).find((chave) => lista[chave]);
    if (!primeiro) return;
    requestAnimationFrame(() => {
      const elemento = document.getElementById(primeiro);
      if (elemento) {
        elemento.scrollIntoView({ block: "center", behavior: "smooth" });
        elemento.focus({ preventScroll: true });
      } else {
        tituloRef.current?.focus();
      }
    });
  };

  const enviar = async () => {
    // §23, rede 1 de 3. Ver o cabeçalho.
    if (enviandoRef.current) return;

    const payload = {
      slug: page.slug,
      companyName,
      participants: linhas.map(({ key: _key, ...pessoa }) => pessoa),
      consentVersion: page.consent?.version ?? "",
      consentAccepted,
    };

    // ⚠️ O MESMO SCHEMA QUE A ACTION RODA. Aqui ele serve para a pessoa ver o
    // erro no campo; lá ele serve para o servidor não confiar nesta tela. E
    // nenhum dos dois é a última barreira: as sete regras de negócio estão em
    // `create_event_registration`, sob lock.
    const conferido = publicRegistrationSchema.safeParse(payload);
    if (!conferido.success) {
      const lista: Erros = {};
      for (const problema of conferido.error.issues) {
        const chave = problema.path.join(".");
        if (!lista[chave]) lista[chave] = problema.message;
      }
      setErros(lista);
      setErroEnvio(null);
      focarPrimeiroErro(lista);
      return;
    }

    enviandoRef.current = true;
    setEstado("submitting");
    setErroEnvio(null);

    try {
      const resultado = await submitEventRegistrationAction(conferido.data);

      if (resultado.ok) {
        // `duplicate` não vira mensagem: quem clicou duas vezes fez UMA
        // inscrição e vê UMA confirmação. Ver `PublicRegistrationResult`.
        setEstado("success");
        requestAnimationFrame(() => tituloRef.current?.focus());
        return;
      }

      // ⚠️ DOIS ERROS DE NEGÓCIO TROCAM O ESTADO DA TELA, e não só a mensagem.
      // Entre o instante em que esta página carregou e o instante do envio,
      // outra granja pode ter tomado as últimas vagas ou o prazo pode ter
      // vencido. Continuar mostrando o formulário depois disso convidaria a
      // pessoa a tentar de novo um envio que o banco vai recusar de novo.
      if (resultado.error.code === "registrationsFull") {
        setEstado("soldOut");
        return;
      }
      if (
        resultado.error.code === "registrationsClosed" ||
        resultado.error.code === "landingNotAcceptingRegistrations"
      ) {
        setEstado("closed");
        return;
      }

      setEstado("error");
      setErroEnvio(
        resultado.error.code === "invalidInput" || resultado.error.code === "unexpected"
          ? PUBLIC_LANDING_COPY.genericError
          : ACTION_ERROR_MESSAGES[resultado.error.code],
      );
      requestAnimationFrame(() => tituloRef.current?.focus());
    } catch {
      // Rede caiu, aba suspensa, servidor fora do ar. Os valores continuam no
      // estado — dizer isso é o que impede a pessoa de recomeçar do zero.
      setEstado("error");
      setErroEnvio(PUBLIC_LANDING_COPY.networkError);
    } finally {
      enviandoRef.current = false;
    }
  };

  if (estado === "closed" || estado === "soldOut") {
    return <AvisoInscricoesFechadas motivo={estado} />;
  }

  if (estado === "success") {
    return <TelaDeSucesso page={page} tituloRef={tituloRef} />;
  }

  const enviando = estado === "submitting";
  const noTeto = linhas.length >= MAX_PARTICIPANTS_PER_REGISTRATION;

  return (
    <form
      noValidate
      onSubmit={(evento) => {
        evento.preventDefault();
        void enviar();
      }}
      className="border-hairline bg-card space-y-6 rounded-2xl border p-5 sm:p-7"
    >
      <h2
        id="inscricao"
        ref={tituloRef}
        tabIndex={-1}
        className="font-display text-primary-strong scroll-mt-4 text-xl font-extrabold tracking-tight uppercase focus:outline-none"
      >
        {PUBLIC_LANDING_COPY.formTitle}
      </h2>

      {/* §30 e §41 — o erro do envio, anunciado. `role="alert"` porque ele
          aparece DEPOIS de uma ação da pessoa: quem usa leitor de tela precisa
          ouvir sem ter de procurar. */}
      {erroEnvio && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm font-medium"
        >
          {erroEnvio}
        </p>
      )}

      {/* §9 — a granja aparece UMA VEZ. A inscrição é dela; as pessoas
          pertencem a ela. */}
      {mostraCampo("GRANJA_EMPRESA") && (
        <TextField
          id="companyName"
          name="organization"
          autoComplete="organization"
          label={LANDING_FIELD_LABELS.GRANJA_EMPRESA}
          value={companyName}
          disabled={enviando}
          error={erros["companyName"]}
          onChange={(evento) => {
            setCompanyName(evento.target.value);
            setErros((atual) => ({ ...atual, companyName: undefined }));
          }}
        />
      )}

      <div className="space-y-5">
        {linhas.map((linha, indice) => (
          <BlocoParticipante
            key={linha.key}
            linha={linha}
            indice={indice}
            campos={page.formFields}
            erros={erros}
            desabilitado={enviando}
            podeRemover={linhas.length > 1}
            onChange={setLinha}
            onRemove={() => remover(indice)}
          />
        ))}
      </div>

      {/* §11 e §31 — um `<button>` de verdade, com texto, alcançável por
          teclado como qualquer outro. */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={adicionar}
          disabled={enviando || noTeto}
          className="border-input text-primary-strong hover:bg-accent focus:ring-ring/30 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm font-semibold transition-colors focus:ring-2 focus:outline-none disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden="true" />
          {PUBLIC_LANDING_COPY.addParticipant}
        </button>

        {/* §13 — a frase que o prompt pede, e ela só aparece quando é verdade.
            O banco recusa igual (o `.max` do schema), então esta é a mensagem,
            não a regra. */}
        {noTeto && (
          <p role="status" className="text-muted-foreground text-xs">
            O limite de participantes por inscrição foi atingido.
          </p>
        )}
      </div>

      {/* §35 — o consentimento é o mecanismo QUE JÁ EXISTE: o mesmo texto de
          `consent_texts` que a landing de associação mostra, e a mesma versão
          gravada junto do registro. */}
      {page.consent && (
        <CheckboxRow
          id="consentAccepted"
          checked={consentAccepted}
          error={erros["consentAccepted"]}
          onChange={(marcado) => {
            setConsentAccepted(marcado);
            setErros((atual) => ({ ...atual, consentAccepted: undefined }));
          }}
        >
          <span className="text-muted-foreground block text-xs font-semibold tracking-wide uppercase">
            {PUBLIC_LANDING_COPY.consentLead}
          </span>
          {page.consent.body}
        </CheckboxRow>
      )}

      <button
        type="submit"
        disabled={enviando}
        // §23, rede 2 de 3. `aria-busy` é o que faz o leitor de tela anunciar
        // que algo está em curso — sem ele, o botão só "para de responder".
        aria-busy={enviando}
        className="bg-primary text-primary-foreground hover:bg-primary-strong focus:ring-ring/40 h-12 w-full rounded-lg text-sm font-bold tracking-wide uppercase transition-colors focus:ring-2 focus:outline-none disabled:opacity-70"
      >
        {enviando ? PUBLIC_LANDING_COPY.submitting : PUBLIC_LANDING_COPY.submit}
      </button>
    </form>
  );
}

/**
 * Um participante.
 *
 * ⚠️ A ORDEM DOS CAMPOS É A DE `campos`, e não a escrita aqui. O Builder do
 * Prompt 2 arrasta essa lista; esta tela é onde o arrasto vira consequência.
 */
function BlocoParticipante({
  linha,
  indice,
  campos,
  erros,
  desabilitado,
  podeRemover,
  onChange,
  onRemove,
}: {
  linha: Linha;
  indice: number;
  campos: LandingFieldKey[];
  erros: Erros;
  desabilitado: boolean;
  podeRemover: boolean;
  onChange: (indice: number, campo: keyof ParticipantInput, valor: string) => void;
  onRemove: () => void;
}) {
  const posicao = indice + 1;
  const prefixo = `participants.${indice}`;

  /** O que cada chave de campo desenha. A granja não entra: ela é da inscrição. */
  const controles: Partial<Record<LandingFieldKey, React.ReactNode>> = {
    EMAIL: (
      <TextField
        key="EMAIL"
        id={`${prefixo}.email`}
        type="email"
        inputMode="email"
        autoComplete="email"
        // ⚠️ SEM `toLowerCase` NO VALOR EXIBIDO (§16). A comparação é
        // insensível a caixa no schema e no Postgres; o que a pessoa digitou
        // continua na tela como ela digitou.
        autoCapitalize="none"
        spellCheck={false}
        label={LANDING_FIELD_LABELS.EMAIL}
        value={linha.email}
        disabled={desabilitado}
        error={erros[`${prefixo}.email`]}
        onChange={(evento) => onChange(indice, "email", evento.target.value)}
      />
    ),
    NOME_PARTICIPANTE: (
      <TextField
        key="NOME_PARTICIPANTE"
        id={`${prefixo}.fullName`}
        autoComplete="name"
        label={LANDING_FIELD_LABELS.NOME_PARTICIPANTE}
        value={linha.fullName}
        disabled={desabilitado}
        error={erros[`${prefixo}.fullName`]}
        onChange={(evento) => onChange(indice, "fullName", evento.target.value)}
      />
    ),
    TELEFONE: (
      <TextField
        key="TELEFONE"
        id={`${prefixo}.phone`}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        label={LANDING_FIELD_LABELS.TELEFONE}
        hint={PUBLIC_LANDING_COPY.contactHint}
        optional
        value={linha.phone ?? ""}
        disabled={desabilitado}
        error={erros[`${prefixo}.phone`]}
        // §17 — a máscara EXISTENTE da plataforma, sem cortar número
        // internacional. Ver `formatPhoneInput`.
        onChange={(evento) => onChange(indice, "phone", formatPhoneInput(evento.target.value))}
      />
    ),
    WHATSAPP: (
      <TextField
        key="WHATSAPP"
        id={`${prefixo}.whatsapp`}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        label={LANDING_FIELD_LABELS.WHATSAPP}
        optional
        value={linha.whatsapp ?? ""}
        disabled={desabilitado}
        error={erros[`${prefixo}.whatsapp`]}
        onChange={(evento) => onChange(indice, "whatsapp", formatPhoneInput(evento.target.value))}
      />
    ),
  };

  return (
    <fieldset className="border-hairline bg-surface/60 relative space-y-4 rounded-xl border p-4">
      {/*
        ============================================================================
        ⚠️ A `<legend>` É O PRIMEIRO FILHO DO `<fieldset>`, E NÃO PODE DEIXAR DE SER.
        ============================================================================
        ELA ESTAVA DENTRO DE UMA `<div>` DE LAYOUT, JUNTO DO BOTÃO DE REMOVER — e um
        teste de acessibilidade encontrou o defeito. O HTML só trata a `<legend>`
        como legenda do grupo quando ela é o primeiro filho direto; embrulhada, ela
        vira um texto qualquer, e o `<fieldset>` fica SEM NOME ACESSÍVEL.
        A consequência para quem usa leitor de tela: cinco blocos idênticos de
        "E-mail, Nome, Telefone, WhatsApp", sem nada dizendo a qual participante
        cada um pertence. Na tela o texto aparecia igual nos dois casos — é
        exatamente o tipo de defeito que só um teste por papel/nome encontra.

        O botão de remover ficou posicionado por CSS em vez de por estrutura: a
        ordem do DOM continua sendo legenda → botão → campos, que é também a ordem
        certa de tabulação.

        ⚠️ E O `w-full` NÃO É ENFEITE: SEM ELE, O RÓTULO "E-MAIL" SAÍA TORTO.
        A `<legend>` precisa do `float-left` para deixar a renderização especial
        que o navegador dá a ela (encaixada no traço da borda) e virar uma caixa
        de bloco comum. Só que um float ESTREITO deixa espaço à direita, e a
        primeira linha do primeiro rótulo escorregava para esse espaço: o texto
        do "E-mail" começava 118px adiantado — a largura exata de
        "PARTICIPANTE 1" — enquanto Nome, Telefone e WhatsApp começavam no lugar
        certo. Um float de largura TOTAL não deixa vão nenhum ao lado, e o
        conteúdo volta a cair embaixo dele.

        Só o primeiro rótulo aparecia torto, e só em tela larga: no celular não
        cabia texto ao lado do float, então a linha já descia sozinha. É o tipo
        de defeito que passa por toda uma bateria de testes — o DOM está certo,
        os papéis estão certos, os nomes acessíveis estão certos; o que está
        errado é onde o navegador desenhou.
      */}
      <legend className="text-muted-foreground float-left w-full text-xs font-semibold tracking-[0.14em] uppercase">
        {PUBLIC_LANDING_COPY.participantLegend(posicao)}
      </legend>

      {podeRemover && (
        <button
          type="button"
          onClick={onRemove}
          disabled={desabilitado}
          // ⚠️ O RÓTULO NOMEIA QUEM SAI. "Remover" sozinho, repetido em cinco
          // blocos, faz um leitor de tela anunciar cinco botões idênticos.
          aria-label={PUBLIC_LANDING_COPY.removeParticipant(posicao)}
          className="text-muted-foreground hover:text-destructive focus:ring-ring/30 absolute top-3 right-3 inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors focus:ring-2 focus:outline-none disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Remover
        </button>
      )}

      {/*
        O `pt-5` que morava aqui era a tentativa anterior de escapar do float —
        empurrar os campos para baixo até passarem dele. Não funcionava, porque
        a caixa de MARGEM do float (os 16px do `space-y-4`) contava junto e
        alcançava a primeira linha mesmo assim. Com a legenda ocupando a largura
        toda, a folga já vem da margem dela e este afastamento vira sobra.
      */}
      <div className="space-y-4">
        {campos.filter((campo) => campo !== "GRANJA_EMPRESA").map((campo) => controles[campo])}
      </div>
    </fieldset>
  );
}

/**
 * §24 e §26 — a tela de confirmação.
 *
 * ⚠️ ELA SUBSTITUI O FORMULÁRIO, e não aparece ao lado dele. É o §26 escrito
 * como estrutura: não há botão para clicar de novo porque não há mais
 * formulário na página. Recarregar também não cria nada — a inscrição foi uma
 * Server Action, e um F5 é um GET.
 *
 * ⚠️ O TEXTO É O CONFIGURADO NO BUILDER (§25), resolvido pela MESMA
 * `resolveSuccessMessage` que a prévia usa. Sem `dangerouslySetInnerHTML` em
 * lugar nenhum: o texto entra como TEXTO, então nem uma configuração
 * malformada nem um administrador mal-intencionado conseguem injetar HTML aqui
 * (§25, §34).
 */
function TelaDeSucesso({
  page,
  tituloRef,
}: {
  page: PublicRegistrationFormData;
  tituloRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const mensagem = resolveSuccessMessage(
    {
      successTitle: page.successTitle,
      successMessage: page.successMessage,
      successFooter: page.successFooter,
    },
    page.successDefaults,
    page.event,
  );

  return (
    <div
      // `role="status"` + `aria-live` para o resultado ser ANUNCIADO: a tela
      // trocou sozinha, sem a pessoa navegar para lugar nenhum.
      role="status"
      aria-live="polite"
      className="border-hairline bg-card rounded-2xl border px-6 py-10 text-center"
    >
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground mx-auto flex size-14 items-center justify-center rounded-full text-2xl"
      >
        ✓
      </span>

      <h2
        ref={tituloRef}
        tabIndex={-1}
        className="font-display text-primary-strong mt-5 text-2xl font-extrabold tracking-tight uppercase focus:outline-none"
      >
        {mensagem.title}
      </h2>

      <p className="mt-4 text-base leading-relaxed whitespace-pre-line">{mensagem.message}</p>

      {/*
        ============================================================================
        ⚠️ A DATA E O HORÁRIO APARECEM SEMPRE — CORREÇÃO DA HOMOLOGAÇÃO (§16).
        ============================================================================
        O §24 do Prompt 3 já desenhava a confirmação com a data logo abaixo da
        frase, e o §16 do Prompt 5 repete: "apresentar também: data do evento".
        A tela mostrava só os três blocos de texto configurados — e quando é
        o evento só aparecia se o administrador tivesse lembrado de escrever
        `{{event_date}}` na mensagem.

        Quem acabou de se inscrever precisa saber QUANDO comparecer, e essa
        informação não pode depender de alguém ter configurado um marcador. Ela
        vem do EVENTO, que é a fonte da verdade — não de texto digitado.
      */}
      <p className="text-foreground mt-5 text-base font-semibold">
        {formatCalendarDate(page.event.eventDate)}
      </p>
      <p className="text-muted-foreground text-sm">
        {formatTimeRange(page.event.startTime, page.event.endTime)}
      </p>

      <p className="text-muted-foreground mt-6 text-sm leading-relaxed whitespace-pre-line">
        {mensagem.footer}
      </p>
    </div>
  );
}
