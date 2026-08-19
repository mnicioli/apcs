"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApcsAnimatedLogo } from "../apcs-logo";
import { ReviewConsent, StepContact, StepContext, StepProfile } from "./steps";
import { submitMembershipApplicationAction } from "@/lib/actions/membership";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  emptyApplication,
  membershipApplicationSchema,
  type MembershipApplicationInput,
} from "@/modules/membership/membership.schema";
import type { MembershipProfileType } from "@/modules/membership/membership.types";

/**
 * O formulário de solicitação de associação, em três etapas.
 *
 * ⚠️ DECISÕES QUE PARECEM DETALHE E NÃO SÃO
 *
 * 1. O ESTADO É UM `useState` SÓ, e não React Hook Form. É a exceção
 *    consciente ao padrão do projeto (ver CLAUDE.md): as etapas validam
 *    PARCIALMENTE o mesmo schema — a etapa 2 não pode reclamar de um campo da
 *    etapa 3 —, e isso é `safeParse` filtrado por etapa, não `resolver`. O
 *    schema É o mesmo do servidor; o que muda é quando cada pedaço dele fala.
 *
 * 2. O CONSENTIMENTO SÓ É COBRADO NO ENVIO. Ele aparece na etapa 3 junto com a
 *    revisão, e `handleContinue` remove o erro dele de propósito: barrar a
 *    passagem por um aceite que ainda nem foi mostrado seria acusar a pessoa de
 *    não ter lido algo que ela não viu.
 *
 * 3. `submittingRef` E NÃO `status === "submitting"` no guarda de envio duplo.
 *    `setStatus` é assíncrono: dois cliques rápidos passam os dois pelo `if`
 *    antes do primeiro `render`. O `ref` muda na hora. A segunda rede de
 *    proteção está no banco (`dedupe_key`), porque esta aqui não sobrevive a um
 *    F5 no meio do envio.
 */

type Errors = Record<string, string | undefined>;

/** Quais campos cada etapa é responsável por cobrar. */
const STAGE_FIELDS: Record<number, string[]> = {
  1: ["profileType"],
  2: ["fullName", "whatsapp", "email", "city", "state", "organization"],
  3: [
    "farmName",
    "productionCity",
    "sowCount",
    "cnpj",
    "stateRegistration",
    "activityArea",
    "jobTitle",
    "legalName",
    "tradeName",
    "interests",
    "otherInterest",
    "consentAccepted",
  ],
};

const TOTAL_STAGES = 3;
const STAGE_LABELS = ["Perfil", "Contato", "Contexto"];

export function MembershipForm() {
  const [values, setValues] = useState<MembershipApplicationInput>(emptyApplication);
  const [errors, setErrors] = useState<Errors>({});
  const [stage, setStage] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "success">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<string | null>(null);
  const [sweep, setSweep] = useState<"forward" | "back" | null>(null);

  const submittingRef = useRef(false);
  const sweepTimers = useRef<number[]>([]);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);

  // Sair da página no meio da cortina deixaria dois timers pendurados.
  useEffect(
    () => () => {
      for (const timer of sweepTimers.current) window.clearTimeout(timer);
    },
    [],
  );

  const setField = useCallback(
    <K extends keyof MembershipApplicationInput>(key: K, value: MembershipApplicationInput[K]) => {
      setValues((atual) => ({ ...atual, [key]: value }));
      // O erro do campo some assim que a pessoa mexe nele: manter a mensagem
      // vermelha enquanto ela corrige é dizer que está errado o que ela está
      // justamente consertando.
      setErrors((atual) => ({ ...atual, [key as string]: undefined }));
    },
    [],
  );

  const validateStage = useCallback(
    (etapa: number) => {
      const resultado = membershipApplicationSchema.safeParse(values);
      if (resultado.success) return {} as Errors;

      const campos = STAGE_FIELDS[etapa] ?? [];
      const erros: Errors = {};
      for (const issue of resultado.error.issues) {
        const caminho = String(issue.path[0] ?? "");
        if (campos.includes(caminho) && !erros[caminho]) erros[caminho] = issue.message;
      }
      return erros;
    },
    [values],
  );

  /** Leva o foco ao primeiro campo com erro — sem isso, a pessoa vê a tela
   *  recusar o "Continuar" e não descobre onde está o problema. */
  const focusFirstError = (erros: Errors) => {
    const primeiro = Object.keys(erros)[0];
    if (!primeiro) return;
    requestAnimationFrame(() => {
      const elemento = document.getElementById(primeiro);
      if (elemento) {
        elemento.scrollIntoView({ block: "center", behavior: "smooth" });
        elemento.focus({ preventScroll: true });
      } else {
        stageHeadingRef.current?.focus();
      }
    });
  };

  const goTo = (proxima: number, sentido: "forward" | "back") => {
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setDirection(sentido);

    if (reduzido) {
      setStage(proxima);
      requestAnimationFrame(() => stageHeadingRef.current?.focus());
      return;
    }

    // A troca de etapa acontece ATRÁS da cortina vermelha, no meio da
    // animação: é isso que faz a transição parecer um corte e não um pulo.
    setSweep(sentido);
    sweepTimers.current.push(
      window.setTimeout(() => {
        setStage(proxima);
        requestAnimationFrame(() => stageHeadingRef.current?.focus());
      }, 190),
      window.setTimeout(() => setSweep(null), 420),
    );
  };

  const handleContinue = () => {
    const erros = validateStage(stage);
    delete erros["consentAccepted"];
    if (Object.keys(erros).length > 0) {
      setErrors((atual) => ({ ...atual, ...erros }));
      focusFirstError(erros);
      return;
    }
    goTo(Math.min(stage + 1, TOTAL_STAGES), "forward");
  };

  const handleBack = () => goTo(Math.max(stage - 1, 1), "back");

  const handleSubmit = async () => {
    if (submittingRef.current) return;

    const erros = validateStage(3);
    if (Object.keys(erros).length > 0) {
      setErrors((atual) => ({ ...atual, ...erros }));
      focusFirstError(erros);
      return;
    }

    submittingRef.current = true;
    setStatus("submitting");
    setSubmitError(null);

    try {
      const resultado = await submitMembershipApplicationAction(values);
      if (resultado.ok) {
        // `duplicate` não vira mensagem: quem clicou duas vezes enviou UMA
        // solicitação e recebe UM protocolo. Contar o detalhe técnico só
        // criaria dúvida sobre um envio que deu certo.
        setProtocol(resultado.data.protocol);
        setStatus("success");
        requestAnimationFrame(() => stageHeadingRef.current?.focus());
        return;
      }

      setStatus("error");
      setSubmitError(
        resultado.error.code === "invalidInput"
          ? "Alguns campos precisam ser corrigidos. Revise as etapas anteriores e tente novamente."
          : ACTION_ERROR_MESSAGES[resultado.error.code],
      );
    } catch {
      // Rede caiu, aba suspensa, servidor fora do ar. Os valores continuam no
      // estado — dizer isso é o que impede a pessoa de recomeçar do zero.
      setStatus("error");
      setSubmitError(
        "Não foi possível concluir o envio. Verifique sua conexão. Suas informações continuam preenchidas.",
      );
    } finally {
      submittingRef.current = false;
    }
  };

  if (status === "success") {
    return (
      <>
        <h2 ref={stageHeadingRef} tabIndex={-1} className="sr-only">
          Solicitação enviada
        </h2>
        <div role="status" aria-live="polite">
          <SuccessState protocol={protocol} />
        </div>
      </>
    );
  }

  const enviando = status === "submitting";

  return (
    <div className="border-hairline bg-card relative overflow-hidden rounded-2xl border shadow-[0_18px_50px_-28px_color-mix(in_oklab,var(--primary)_45%,transparent)] lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {sweep && (
        <div
          aria-hidden
          className={sweep === "forward" ? "apcs-panel-sweep z-20" : "apcs-panel-sweep-back z-20"}
        />
      )}

      <aside className="text-primary-foreground relative isolate min-h-[34rem] overflow-hidden sm:min-h-[36rem] lg:min-h-[36rem]">
        <Image
          src="/associe-se/suinos.jpg"
          alt="Suínos em granja"
          fill
          sizes="(min-width: 1024px) 22rem, 100vw"
          className="apcs-form-photo -z-10 object-cover"
        />

        {/* A cunha diagonal que sobe do bloco vermelho é um `::before` com
            `clip-path`, e não um SVG: um elemento a menos no DOM e a forma
            acompanha a largura sozinha. */}
        <div className="bg-primary before:bg-primary absolute inset-x-0 bottom-0 px-6 pt-5 pb-7 [--wedge:2.5rem] before:absolute before:inset-x-0 before:bottom-full before:h-[var(--wedge)] before:content-[''] before:[clip-path:polygon(0_100%,100%_0,100%_100%)] sm:px-8 lg:pb-10 lg:[--wedge:4rem]">
          <p className="font-display text-xl leading-[1.15] font-extrabold uppercase sm:text-2xl">
            Sua experiência ajuda a fortalecer a suinocultura.
          </p>
          <p className="mt-3 text-sm leading-relaxed opacity-90">
            Conte como você participa do setor.
            <br className="hidden sm:block" /> São apenas três etapas rápidas.
          </p>
          <p className="mt-5 flex items-center gap-2 text-xs font-medium opacity-90">
            <StepCounter /> etapas <span aria-hidden>•</span>
            <svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path className="apcs-clock-hand" d="M12 7v5l3 2" strokeLinecap="round" />
            </svg>
            poucos minutos
          </p>
        </div>
      </aside>

      <div className="min-w-0 p-6 sm:p-8 lg:p-10">
        {/* O título visível de cada etapa é a `<legend>` do fieldset. Este aqui
            existe só para o foco pousar em algum lugar anunciável na troca. */}
        <h2 ref={stageHeadingRef} tabIndex={-1} className="sr-only">
          Etapa {stage} de {TOTAL_STAGES}
        </h2>

        <ProgressSteps current={stage} total={TOTAL_STAGES} />

        <form
          className="mt-8"
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            if (stage === TOTAL_STAGES) void handleSubmit();
            else handleContinue();
          }}
        >
          {/* A `key` remonta o bloco a cada etapa: é o que dispara a animação
              de entrada, sem ninguém chamar animação nenhuma. */}
          <div
            key={stage}
            className={direction === "forward" ? "apcs-step-enter" : "apcs-step-enter-back"}
          >
            {stage === 1 && (
              <StepProfile
                value={values.profileType as MembershipProfileType | undefined}
                error={errors["profileType"]}
                onChange={(valor) => setField("profileType", valor)}
              />
            )}
            {stage === 2 && <StepContact values={values} errors={errors} setField={setField} />}
            {stage === 3 && (
              <div className="space-y-10">
                <StepContext values={values} errors={errors} setField={setField} />
                <ReviewConsent
                  values={values}
                  consentError={errors["consentAccepted"]}
                  onConsentChange={(marcado) =>
                    setField("consentAccepted", marcado as unknown as true)
                  }
                />
              </div>
            )}
          </div>

          {submitError && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive mt-8 rounded-lg border px-4 py-3 text-sm"
            >
              {submitError}
            </div>
          )}

          <div className="border-hairline mt-10 flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:items-center">
            {stage > 1 && (
              <button
                type="button"
                className="border-input bg-card text-foreground hover:bg-muted focus-visible:ring-ring inline-flex h-12 items-center justify-center rounded-md border px-6 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50 sm:w-auto"
                onClick={handleBack}
                disabled={enviando}
              >
                Voltar
              </button>
            )}

            <button
              type="submit"
              className="apcs-cta bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-12 w-full flex-1 items-center justify-center rounded-md px-8 text-base font-semibold focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
              disabled={enviando}
            >
              {stage === TOTAL_STAGES
                ? enviando
                  ? "Enviando…"
                  : "Enviar minha solicitação"
                : "Continuar"}
            </button>
          </div>

          <p className="text-muted-foreground mt-3 text-center text-xs">
            Você poderá revisar suas respostas antes de enviar.
          </p>

          <p role="status" aria-live="polite" className="sr-only">
            {enviando ? "Enviando sua solicitação, aguarde." : ""}
          </p>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças de apoio                                                             */
/* -------------------------------------------------------------------------- */

function ProgressSteps({ current, total }: { current: number; total: number }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-foreground text-sm font-medium">
          Etapa {current} de {total}
        </p>
        <p className="text-muted-foreground text-sm">{STAGE_LABELS[current - 1]}</p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={`Etapa ${current} de ${total}: ${STAGE_LABELS[current - 1]}`}
        className="flex gap-2"
      >
        {Array.from({ length: total }, (_, indice) => (
          <span
            key={indice}
            className="bg-surface-strong h-1.5 flex-1 overflow-hidden rounded-full"
          >
            <span
              className="bg-primary block h-full origin-left rounded-full transition-transform duration-200"
              style={{ transform: `scaleX(${indice < current ? 1 : 0})` }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Conta 1, 2, 3 quando o painel entra na tela — uma vez só. */
function StepCounter({ to = 3 }: { to?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [valor, setValor] = useState(to);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timers: number[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setValor(1);
        for (let passo = 2; passo <= to; passo += 1) {
          timers.push(window.setTimeout(() => setValor(passo), (passo - 1) * 420));
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    };
  }, [to]);

  return (
    // O `aria-label` diz "3 etapas" o tempo todo: a contagem é decoração, e o
    // leitor de tela não deve anunciar 1, depois 2, depois 3.
    <span ref={ref} className="tabular-nums" aria-label={`${to} etapas`}>
      <span key={valor} className="apcs-count-pop inline-block" aria-hidden>
        {valor}
      </span>
    </span>
  );
}

function SuccessState({ protocol }: { protocol: string | null }) {
  return (
    <div className="apcs-step-enter border-hairline bg-card rounded-2xl border p-8 text-center sm:p-10">
      <div className="flex flex-col items-center">
        <ApcsAnimatedLogo width="clamp(150px, 40vw, 220px)" />
        <h2 className="mt-6 text-2xl font-bold">Recebemos sua solicitação</h2>
      </div>

      <p className="text-muted-foreground mx-auto mt-5 max-w-[40rem] text-base">
        Sua solicitação de filiação foi registrada. O envio não representa aprovação automática: a
        equipe da APCS analisará as informações e entrará em contato para orientar os próximos
        passos.
      </p>

      {protocol && (
        <p className="text-muted-foreground mt-4 text-sm">
          Protocolo da solicitação: <span className="text-foreground font-mono">{protocol}</span>
        </p>
      )}

      <ul className="text-muted-foreground mx-auto mt-6 inline-block space-y-2 text-left text-sm">
        <li>• A análise é feita pela equipe da APCS.</li>
        <li>• O contato será feito pelos dados informados no formulário.</li>
        <li>• Nenhuma ação adicional é necessária agora.</li>
      </ul>
    </div>
  );
}
