"use client";

import { CheckboxRow, SelectField, TextField, ToggleChip } from "./fields";
import { cn } from "@/lib/utils";
import {
  formatCnpj,
  formatWhatsapp,
  INTEREST_OPTIONS,
  PROFILE_OPTIONS,
  UFS,
  type MembershipApplicationInput,
} from "@/modules/membership/membership.schema";
import type { MembershipProfileType } from "@/modules/membership/membership.types";

/**
 * As três etapas do formulário e a revisão final.
 *
 * A ordem é a do layout validado, e ela tem uma razão: PERFIL primeiro, porque
 * é a resposta que decide quais campos a etapa 3 vai pedir. Perguntar CNPJ
 * antes de saber se quem responde é uma empresa é fazer três pessoas em cada
 * quatro pularem um campo.
 */

type Errors = Record<string, string | undefined>;

interface StepProps {
  values: MembershipApplicationInput;
  errors: Errors;
  setField: <K extends keyof MembershipApplicationInput>(
    key: K,
    value: MembershipApplicationInput[K],
  ) => void;
}

/**
 * Áreas de atuação do perfil Técnicos.
 *
 * ⚠️ Universidades NÃO usa esta lista, ainda que grave na mesma coluna
 * (`activity_area`). Ela é um recorte da cadeia produtiva — "Nutrição",
 * "Sanidade / veterinária" —, e obrigar uma universidade a escolher entre elas
 * produziria dado errado com cara de dado certo. Lá o campo é texto livre.
 */
const ACTIVITY_AREAS = [
  "Técnica / produção",
  "Nutrição",
  "Sanidade / veterinária",
  "Comercial",
  "Institucional / associativa",
  "Pesquisa / ensino",
  "Outra",
];

/* -------------------------------------------------------------------------- */
/* Etapa 1 — perfil                                                           */
/* -------------------------------------------------------------------------- */

export function StepProfile({
  value,
  onChange,
  error,
}: {
  value: MembershipProfileType | undefined;
  onChange: (value: MembershipProfileType) => void;
  error?: string | undefined;
}) {
  return (
    <fieldset>
      <legend className="text-xl font-semibold">Qual opção melhor representa você?</legend>
      <p className="text-muted-foreground mt-2 text-sm">Escolha apenas uma opção.</p>

      {/*
        `role="radiogroup"` com botões, e não `<input type="radio">`: o alvo de
        toque é o cartão inteiro (não um círculo de 20px), que é o que faz a
        etapa funcionar no celular. O papel ARIA devolve ao leitor de tela a
        semântica que o `<button>` sozinho não teria.
      */}
      <div
        role="radiogroup"
        aria-label="Qual opção melhor representa você?"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "profileType-error" : undefined}
        className="mt-6 grid gap-3"
      >
        {PROFILE_OPTIONS.map((opcao) => {
          const selecionado = value === opcao.value;
          return (
            <button
              key={opcao.value}
              id={opcao.value === PROFILE_OPTIONS[0]?.value ? "profileType" : undefined}
              type="button"
              role="radio"
              aria-checked={selecionado}
              onClick={() => onChange(opcao.value)}
              className={cn(
                "flex w-full items-start gap-4 rounded-xl border p-5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.995]",
                selecionado
                  ? "border-primary bg-primary/[0.06] shadow-[0_0_0_1px_var(--primary)_inset]"
                  : "border-hairline bg-card hover:border-primary/40",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  selecionado ? "border-primary" : "border-input",
                )}
              >
                {selecionado && <span className="bg-primary size-2.5 rounded-full" />}
              </span>
              <span>
                <span className="text-foreground block font-semibold">{opcao.label}</span>
                <span className="text-muted-foreground mt-1 block text-sm">
                  {opcao.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p id="profileType-error" className="text-destructive mt-3 text-xs font-medium">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Etapa 2 — contato                                                          */
/* -------------------------------------------------------------------------- */

export function StepContact({ values, errors, setField }: StepProps) {
  return (
    <fieldset className="space-y-6">
      <legend className="text-xl font-semibold">Como podemos falar com você?</legend>

      <TextField
        id="fullName"
        name="fullName"
        label="Nome completo"
        autoComplete="name"
        value={values.fullName}
        error={errors["fullName"]}
        onChange={(evento) => setField("fullName", evento.target.value)}
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          id="whatsapp"
          name="whatsapp"
          label="WhatsApp com DDD"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(54) 99123-4567"
          value={values.whatsapp}
          error={errors["whatsapp"]}
          // A máscara é aplicada a cada tecla: quem digita "54991234567" vê o
          // número se formatar sozinho, e quem cola já formatado não quebra.
          onChange={(evento) => setField("whatsapp", formatWhatsapp(evento.target.value))}
        />
        <TextField
          id="email"
          name="email"
          label="E-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={values.email}
          error={errors["email"]}
          onChange={(evento) => setField("email", evento.target.value)}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-[1fr_140px]">
        <TextField
          id="city"
          name="city"
          label="Cidade"
          autoComplete="address-level2"
          value={values.city}
          error={errors["city"]}
          onChange={(evento) => setField("city", evento.target.value)}
        />
        <SelectField
          id="state"
          name="state"
          label="Estado"
          autoComplete="address-level1"
          value={values.state}
          error={errors["state"]}
          onChange={(evento) =>
            setField("state", evento.target.value as MembershipApplicationInput["state"])
          }
        >
          {UFS.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </SelectField>
      </div>

      <TextField
        id="organization"
        name="organization"
        label="Propriedade, empresa ou organização"
        optional
        autoComplete="organization"
        value={values.organization ?? ""}
        error={errors["organization"]}
        onChange={(evento) => setField("organization", evento.target.value)}
      />
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Etapa 3 — contexto                                                         */
/* -------------------------------------------------------------------------- */

export function StepContext({ values, errors, setField }: StepProps) {
  const alternarInteresse = (interesse: string) => {
    const atuais = values.interests ?? [];
    const proximos = atuais.includes(interesse)
      ? atuais.filter((item) => item !== interesse)
      : [...atuais, interesse];
    setField("interests", proximos);
    // Desmarcou "Outro"? O campo de texto some — e o que estava escrito nele
    // vai junto, senão ele seria enviado sem ninguém ver.
    if (!proximos.includes("Outro")) setField("otherInterest", "");
  };

  return (
    <div className="space-y-8">
      <fieldset className="space-y-6">
        <legend className="text-xl font-semibold">Conte um pouco do seu contexto</legend>

        {values.profileType === "criador" && (
          <>
            <TextField
              id="farmName"
              label="Nome da propriedade"
              optional
              value={values.farmName ?? ""}
              error={errors["farmName"]}
              onChange={(evento) => setField("farmName", evento.target.value)}
            />
            <TextField
              id="productionCity"
              label="Município da produção"
              autoComplete="address-level2"
              value={values.productionCity ?? ""}
              error={errors["productionCity"]}
              onChange={(evento) => setField("productionCity", evento.target.value)}
            />
            <div className="grid gap-6 sm:grid-cols-2">
              <TextField
                id="sowCount"
                label="Número aproximado de matrizes"
                optional
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={values.sowCount ?? ""}
                error={errors["sowCount"]}
                onChange={(evento) =>
                  setField("sowCount", evento.target.value.replace(/\D+/g, "").slice(0, 7))
                }
              />
              <TextField
                id="cnpj"
                label="CNPJ"
                optional
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={values.cnpj ?? ""}
                error={errors["cnpj"]}
                onChange={(evento) => setField("cnpj", formatCnpj(evento.target.value))}
              />
            </div>
            <TextField
              id="stateRegistration"
              label="Inscrição Estadual"
              optional
              value={values.stateRegistration ?? ""}
              error={errors["stateRegistration"]}
              onChange={(evento) => setField("stateRegistration", evento.target.value)}
            />
          </>
        )}

        {values.profileType === "tecnico" && (
          <>
            <SelectField
              id="activityArea"
              label="Área de atuação"
              value={values.activityArea ?? ""}
              error={errors["activityArea"]}
              onChange={(evento) => setField("activityArea", evento.target.value)}
            >
              <option value="">Selecione</option>
              {ACTIVITY_AREAS.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </SelectField>
            <TextField
              id="jobTitle"
              label="Cargo ou função"
              autoComplete="organization-title"
              value={values.jobTitle ?? ""}
              error={errors["jobTitle"]}
              onChange={(evento) => setField("jobTitle", evento.target.value)}
            />
            <TextField
              id="organizationContext"
              label="Organização"
              optional
              autoComplete="organization"
              value={values.organization ?? ""}
              error={errors["organization"]}
              onChange={(evento) => setField("organization", evento.target.value)}
            />
          </>
        )}

        {values.profileType === "empresa" && (
          <>
            <TextField
              id="legalName"
              label="Razão social"
              value={values.legalName ?? ""}
              error={errors["legalName"]}
              onChange={(evento) => setField("legalName", evento.target.value)}
            />
            <TextField
              id="tradeName"
              label="Nome fantasia"
              optional
              value={values.tradeName ?? ""}
              error={errors["tradeName"]}
              onChange={(evento) => setField("tradeName", evento.target.value)}
            />
            <div className="grid gap-6 sm:grid-cols-2">
              <TextField
                id="cnpj"
                label="CNPJ"
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={values.cnpj ?? ""}
                error={errors["cnpj"]}
                onChange={(evento) => setField("cnpj", formatCnpj(evento.target.value))}
              />
              <TextField
                id="stateRegistration"
                label="Inscrição Estadual"
                optional
                value={values.stateRegistration ?? ""}
                error={errors["stateRegistration"]}
                onChange={(evento) => setField("stateRegistration", evento.target.value)}
              />
            </div>
            <TextField
              id="jobTitle"
              label="Cargo ou função do contato"
              autoComplete="organization-title"
              value={values.jobTitle ?? ""}
              error={errors["jobTitle"]}
              onChange={(evento) => setField("jobTitle", evento.target.value)}
            />
          </>
        )}

        {/*
          ⚠️ TODOS OS CAMPOS OPCIONAIS — o único perfil assim, e de propósito.

          Universidade é o único perfil que NÃO é associado: ela não está pedindo
          filiação, está se colocando à disposição para receber comunicação. Exigir
          departamento e cargo de quem não está pedindo nada é atrito sem
          contrapartida, e o resultado seria uma universidade a menos na base.

          Nenhuma coluna nova: reaproveita `organization` (etapa 2),
          `activity_area` e `job_title`. Uma tabela de universidade só para três
          campos que já existem seria uma segunda verdade sobre a mesma pessoa.
        */}
        {values.profileType === "universidade" && (
          <>
            <TextField
              id="activityArea"
              label="Área, curso ou departamento"
              optional
              value={values.activityArea ?? ""}
              error={errors["activityArea"]}
              onChange={(evento) => setField("activityArea", evento.target.value)}
            />
            <TextField
              id="jobTitle"
              label="Cargo ou função"
              optional
              autoComplete="organization-title"
              value={values.jobTitle ?? ""}
              error={errors["jobTitle"]}
              onChange={(evento) => setField("jobTitle", evento.target.value)}
            />
          </>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-base font-semibold">
          Quais temas mais interessam você?{" "}
          <span className="text-muted-foreground font-normal">(opcional, várias opções)</span>
        </legend>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {INTEREST_OPTIONS.map((interesse) => (
            <ToggleChip
              key={interesse}
              pressed={(values.interests ?? []).includes(interesse)}
              onClick={() => alternarInteresse(interesse)}
            >
              {interesse}
            </ToggleChip>
          ))}
        </div>

        {(values.interests ?? []).includes("Outro") && (
          <div className="apcs-step-enter mt-4">
            <TextField
              id="otherInterest"
              label="Qual outro interesse?"
              value={values.otherInterest ?? ""}
              error={errors["otherInterest"]}
              onChange={(evento) => setField("otherInterest", evento.target.value)}
            />
          </div>
        )}
      </fieldset>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Revisão e consentimento                                                    */
/* -------------------------------------------------------------------------- */

function ReviewRow({ label, value }: { label: string; value?: string | undefined }) {
  if (!value) return null;
  return (
    <div className="border-hairline flex flex-col gap-0.5 border-t py-2.5 sm:flex-row sm:gap-4">
      <dt className="text-muted-foreground w-56 shrink-0 text-xs tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-foreground text-sm">{value}</dd>
    </div>
  );
}

export function ReviewConsent({
  values,
  consentText,
  consentError,
  onConsentChange,
}: {
  values: MembershipApplicationInput;
  /**
   * ⚠️ VEM DO SERVIDOR, e não da constante do código. O texto é editável em
   * Configurações e vive em `consent_texts`; a constante virou apenas o padrão
   * de emergência. Se esta prop virasse opcional com fallback aqui, a landing
   * poderia mostrar um texto e a solicitação gravar a versão de outro.
   */
  consentText: string;
  consentError?: string | undefined;
  onConsentChange: (checked: boolean) => void;
}) {
  const perfil = PROFILE_OPTIONS.find((opcao) => opcao.value === values.profileType)?.label;
  const interesses = (values.interests ?? []).join(", ");

  return (
    <section aria-labelledby="review-title" className="space-y-6">
      <div>
        <h3 id="review-title" className="text-base font-semibold">
          Revise antes de enviar
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Você pode voltar às etapas anteriores para ajustar qualquer informação.
        </p>
      </div>

      {/* `ReviewRow` some quando o valor é vazio: uma lista de revisão cheia de
          "—" faz a pessoa procurar o que ela esqueceu de preencher num campo
          que era opcional desde o começo. */}
      <dl className="border-hairline bg-surface rounded-xl border px-5 py-2">
        <ReviewRow label="Perfil" value={perfil} />
        <ReviewRow label="Nome completo" value={values.fullName} />
        <ReviewRow label="WhatsApp" value={values.whatsapp} />
        <ReviewRow label="E-mail" value={values.email} />
        <ReviewRow
          label="Cidade / Estado"
          value={[values.city, values.state].filter(Boolean).join(" / ")}
        />
        <ReviewRow label="Organização" value={values.organization} />
        <ReviewRow label="Propriedade" value={values.farmName} />
        <ReviewRow label="Município da produção" value={values.productionCity} />
        <ReviewRow label="Matrizes (aprox.)" value={values.sowCount} />
        <ReviewRow label="Razão social" value={values.legalName} />
        <ReviewRow label="Nome fantasia" value={values.tradeName} />
        <ReviewRow label="CNPJ" value={values.cnpj} />
        <ReviewRow label="Inscrição Estadual" value={values.stateRegistration} />
        <ReviewRow label="Área de atuação" value={values.activityArea} />
        <ReviewRow label="Cargo ou função" value={values.jobTitle} />
        <ReviewRow label="Interesses" value={interesses} />
        <ReviewRow label="Outro interesse" value={values.otherInterest} />
      </dl>

      <div className="border-hairline bg-card rounded-xl border p-5">
        <CheckboxRow
          id="consentAccepted"
          checked={values.consentAccepted === true}
          onChange={onConsentChange}
          error={consentError}
        >
          {consentText}{" "}
          {/* A política de privacidade oficial ainda não tem endereço público.
              Dizer isso é melhor que um link quebrado numa caixa de aceite. */}
          <span className="text-muted-foreground">
            (Política de privacidade oficial da APCS pendente de publicação.)
          </span>
        </CheckboxRow>
        <p className="text-muted-foreground mt-4 text-xs">
          O envio não representa aprovação automática da filiação. A solicitação passa por análise
          da equipe da APCS.
        </p>
      </div>
    </section>
  );
}
