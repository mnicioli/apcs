import { z } from "zod";
import { MEMBERSHIP_PROFILE_TYPES, type MembershipProfileType } from "./membership.types";

/**
 * Validação do formulário público de associação.
 *
 * ⚠️ ESTE ARQUIVO RODA NOS DOIS LADOS. É o MESMO schema no cliente (React Hook
 * Form, para a pessoa ver o erro enquanto digita) e na Server Action (porque o
 * cliente não é confiável). Por isso ele não importa nada de `server-only` nem
 * toca no Supabase — se importasse, o formulário não compilaria.
 *
 * A terceira camada está no banco: `submit_membership_application` repete as
 * regras de obrigatoriedade por perfil e os CHECKs recusam formato inválido.
 * São três porque as três falham de jeitos diferentes — o cliente pode estar
 * desatualizado, a action pode ter bug, e nenhum dos dois protege contra uma
 * chamada que não passe por eles.
 */

export const PROFILE_OPTIONS: Array<{
  value: MembershipProfileType;
  label: string;
  description: string;
}> = [
  {
    value: "suinocultor",
    label: "Sou suinocultor",
    description: "Atuo diretamente na produção de suínos.",
  },
  {
    value: "profissional",
    label: "Sou profissional do setor",
    description: "Trabalho técnica, comercial ou institucionalmente na cadeia.",
  },
  {
    value: "empresa",
    label: "Represento uma empresa",
    description: "Minha organização fornece, compra ou presta serviços para o setor.",
  },
];

/**
 * Os interesses são TEXTO, não enum de banco — de propósito. A lista muda com a
 * comunicação da APCS, e cada mudança viraria uma migration se fosse enum. O
 * banco guarda `text[]` e limita a dez itens; o que a pessoa escolheu fica
 * legível mesmo depois que a opção sair daqui.
 */
export const INTEREST_OPTIONS = [
  "Representação institucional",
  "Informações de mercado",
  "Eventos e relacionamento",
  "Bolsa de Suínos",
  "CSP e compras coletivas",
  "Outro",
] as const;

/** RS primeiro: é onde a APCS atua. O resto em ordem alfabética. */
export const UFS = [
  "RS",
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

/* -------------------------------------------------------------------------- */
/* Normalizadores e validadores                                               */
/* -------------------------------------------------------------------------- */

export const onlyDigits = (value: string) => value.replace(/\D+/g, "");

export function formatWhatsapp(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatCnpj(value: string) {
  const d = onlyDigits(value).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/** Dígitos verificadores do CNPJ. Recusa também os 14 dígitos repetidos. */
export function isValidCnpj(raw: string) {
  const d = onlyDigits(raw);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = 0; i < len; i += 1) {
      sum += Number(d[i]) * pos;
      pos -= 1;
      if (pos < 2) pos = 9;
    }
    const result = sum % 11;
    return result < 2 ? 0 : 11 - result;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/**
 * DDD + número. Onze dígitos exigem o `9` do celular; dez são fixo.
 *
 * ⚠️ Aceitar fixo é decisão consciente, e ela tem consequência: um fixo NÃO
 * recebe WhatsApp. O módulo de Enquetes trata isso em `src/lib/messaging/
 * phone.ts`, que recusa dez dígitos na hora do disparo. Aqui o cadastro entra —
 * o que não pode é a APCS achar que vai conseguir mandar mensagem para ele.
 */
export function isValidWhatsapp(raw: string) {
  const d = onlyDigits(raw);
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  if (d.length === 11 && d[2] !== "9") return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

const opcional = z
  .string()
  .trim()
  .max(160)
  .optional()
  .transform((v) => (v ? v : undefined));

const cnpjOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => !v || isValidCnpj(v), { message: "CNPJ inválido. Confira os 14 dígitos." });

export const membershipApplicationSchema = z
  .object({
    profileType: z.enum(MEMBERSHIP_PROFILE_TYPES, {
      errorMap: () => ({ message: "Selecione o perfil que melhor representa você." }),
    }),

    fullName: z
      .string()
      .trim()
      .min(3, { message: "Informe seu nome completo." })
      .max(120, { message: "Use no máximo 120 caracteres." }),
    whatsapp: z
      .string()
      .trim()
      .min(1, { message: "Informe seu WhatsApp com DDD." })
      .refine(isValidWhatsapp, {
        message: "WhatsApp inválido. Use DDD + número, ex.: (54) 99123-4567.",
      }),
    email: z
      .string()
      .trim()
      .min(1, { message: "Informe seu e-mail." })
      .max(255, { message: "E-mail muito longo." })
      .email({ message: "E-mail inválido. Confira se há @ e domínio." }),
    city: z.string().trim().min(2, { message: "Informe sua cidade." }).max(120),
    state: z.enum(UFS, { errorMap: () => ({ message: "Selecione o estado." }) }),
    organization: opcional,

    // Suinocultor
    farmName: opcional,
    productionCity: opcional,
    sowCount: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => !v || /^\d{1,7}$/.test(v), {
        message: "Informe um número inteiro igual ou maior que zero.",
      }),
    cnpj: cnpjOpcional,
    stateRegistration: opcional,

    // Profissional do setor
    activityArea: opcional,
    jobTitle: opcional,

    // Empresa
    legalName: opcional,
    tradeName: opcional,

    interests: z.array(z.string().max(80)).max(10).default([]),
    otherInterest: z.string().trim().max(200).optional(),

    // ⚠️ `z.literal(true)`, e não `z.boolean()`: o aceite não é um campo que
    // pode valer `false`, é uma condição para o envio existir. O banco repete a
    // regra num CHECK, porque é ele que responde à LGPD, não o formulário.
    consentAccepted: z.literal(true, {
      errorMap: () => ({ message: "É necessário aceitar o tratamento de dados para enviar." }),
    }),
  })
  .superRefine((data, ctx) => {
    const exigir = (campo: keyof typeof data, mensagem: string) => {
      if (!data[campo])
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: mensagem });
    };

    if (data.profileType === "suinocultor") {
      exigir("productionCity", "Informe o município da produção.");
    }
    if (data.profileType === "profissional") {
      exigir("activityArea", "Informe sua área de atuação.");
      exigir("jobTitle", "Informe seu cargo ou função.");
    }
    if (data.profileType === "empresa") {
      exigir("legalName", "Informe a razão social.");
      exigir("jobTitle", "Informe o cargo ou função do contato.");
      if (!data.cnpj) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cnpj"],
          message: "Informe o CNPJ da empresa.",
        });
      }
    }
    if (data.interests.includes("Outro") && !data.otherInterest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["otherInterest"],
        message: "Conte brevemente qual é o outro interesse.",
      });
    }
  });

export type MembershipApplicationInput = z.input<typeof membershipApplicationSchema>;
export type MembershipApplicationData = z.output<typeof membershipApplicationSchema>;

/**
 * O estado inicial do formulário.
 *
 * `profileType` nasce indefinido de propósito: a primeira etapa é justamente
 * escolher o perfil, e um valor pré-selecionado faria a pessoa passar batido
 * pela pergunta que decide todos os campos seguintes.
 */
export const emptyApplication: MembershipApplicationInput = {
  profileType: undefined as unknown as MembershipProfileType,
  fullName: "",
  whatsapp: "",
  email: "",
  city: "",
  state: "RS",
  organization: "",
  farmName: "",
  productionCity: "",
  sowCount: "",
  cnpj: "",
  stateRegistration: "",
  activityArea: "",
  jobTitle: "",
  legalName: "",
  tradeName: "",
  interests: [],
  otherInterest: "",
  consentAccepted: false as unknown as true,
};

/* -------------------------------------------------------------------------- */
/* Decisões do CRM                                                            */
/* -------------------------------------------------------------------------- */

export const rejectApplicationSchema = z.object({
  id: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(5, { message: "Descreva o motivo em pelo menos 5 caracteres." })
    .max(1000, { message: "Use no máximo 1000 caracteres." }),
});

export const approveApplicationSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(1000, { message: "Use no máximo 1000 caracteres." }).optional(),
});

export const applicationIdSchema = z.object({ id: z.string().uuid() });

export type RejectApplicationInput = z.input<typeof rejectApplicationSchema>;
export type ApproveApplicationInput = z.input<typeof approveApplicationSchema>;
