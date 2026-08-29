import { z } from "zod";
import {
  MEMBERSHIP_PROFILE_TYPES,
  MEMBER_STATUSES,
  type MembershipProfileType,
} from "./membership.types";

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
    value: "criador",
    label: "Sou criador",
    description: "Atuo diretamente na produção de suínos.",
  },
  {
    value: "empresa",
    label: "Represento uma empresa",
    description: "Minha organização fornece, compra ou presta serviços para o setor.",
  },
  {
    // ⚠️ O RÓTULO DIZ "técnico OU profissional do setor" DE PROPÓSITO. O perfil
    // se chama Técnicos, mas ele abriga também quem é comercial e quem é
    // institucional — a descrição sempre disse isso. Um rótulo só "Sou técnico"
    // faria a pessoa da área comercial não se reconhecer e escolher errado, e
    // um cadastro no perfil errado é pior que um rótulo comprido.
    value: "tecnico",
    label: "Sou técnico ou profissional do setor",
    description: "Trabalho técnica, comercial ou institucionalmente na cadeia.",
  },
  {
    // O único perfil que NÃO é associado. Ele está aqui mesmo assim porque a
    // APCS se comunica com universidades — e um cadastro que não existe é um
    // público-alvo que ninguém consegue alcançar.
    value: "universidade",
    label: "Represento uma universidade",
    description: "Atuo em ensino, pesquisa ou extensão ligados à suinocultura.",
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

    if (data.profileType === "criador") {
      exigir("productionCity", "Informe o município da produção.");
    }
    if (data.profileType === "tecnico") {
      exigir("activityArea", "Informe sua área de atuação.");
      exigir("jobTitle", "Informe seu cargo ou função.");
    }
    // ⚠️ `universidade` NÃO TEM CAMPO OBRIGATÓRIO PRÓPRIO, e é decisão, não
    // esquecimento: instituição, área e cargo entram como opcionais. Uma
    // universidade que se cadastra com pouco continua sendo um cadastro; um
    // formulário que a recusa é uma universidade a menos na base. A mesma regra
    // vale no banco (ver `submit_membership_application`), então as duas
    // camadas dizem a mesma coisa.
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

/* -------------------------------------------------------------------------- */
/* Edição do cadastro do associado                                            */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ ESTE SCHEMA É DELIBERADAMENTE MAIS FROUXO QUE O DA LANDING, e a diferença
 * não é descuido — é a diferença entre as duas tabelas.
 *
 * `membershipApplicationSchema` valida um formulário PÚBLICO, onde a hora de
 * cobrar município da produção, CNPJ e razão social é a hora da entrada.
 * `members` é o REGISTRO, e a migration original deixou quase toda coluna
 * anulável de propósito, porque "cadastro legado é incompleto por natureza".
 *
 * Repetir aqui as obrigatoriedades por perfil teria um efeito concreto e ruim:
 * corrigir o telefone de um associado antigo passaria a exigir inventar um CNPJ
 * que ninguém tem. Então só o nome é obrigatório — o mesmo recorte que
 * `update_member` impõe no banco, para as duas camadas dizerem a mesma coisa.
 *
 * O que continua sendo validado é o FORMATO: telefone que não é telefone e CNPJ
 * com dígito errado entram como lixo silencioso, e o disparo de WhatsApp é
 * justamente quem descobre isso — tarde demais, e um associado de cada vez.
 */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Use no máximo ${max} caracteres.` })
    .optional()
    .transform((v) => (v ? v : undefined));

export const updateMemberSchema = z.object({
  memberId: z.string().uuid(),

  fullName: z
    .string()
    .trim()
    .min(3, { message: "Informe o nome completo." })
    .max(160, { message: "Use no máximo 160 caracteres." }),

  status: z.enum(MEMBER_STATUSES, {
    errorMap: () => ({ message: "Selecione a situação do associado." }),
  }),

  // Vazio é um valor legítimo: um cadastro antigo pode não ter perfil definido,
  // e forçar um chute aqui inventaria dado — inclusive para o público-alvo de
  // uma divulgação, que lê exatamente esta coluna.
  profileType: z
    .union([z.enum(MEMBERSHIP_PROFILE_TYPES), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),

  code: textoOpcional(40),

  whatsapp: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || isValidWhatsapp(v), {
      message: "WhatsApp inválido. Use DDD + número, ex.: (54) 99123-4567.",
    }),

  email: z
    .string()
    .trim()
    .max(255, { message: "E-mail muito longo." })
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || z.string().email().safeParse(v).success, {
      message: "E-mail inválido. Confira se há @ e domínio.",
    }),

  city: textoOpcional(120),

  // A UF vai para uma coluna com CHECK `^[A-Z]{2}$`; "" vira nulo antes disso.
  state: z
    .union([z.enum(UFS), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),

  organization: textoOpcional(160),
  farmName: textoOpcional(160),
  productionCity: textoOpcional(160),

  sowCount: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || /^\d{1,7}$/.test(v), {
      message: "Informe um número inteiro igual ou maior que zero.",
    }),

  cnpj: cnpjOpcional,
  stateRegistration: textoOpcional(160),
  activityArea: textoOpcional(160),
  jobTitle: textoOpcional(160),
  legalName: textoOpcional(160),
  tradeName: textoOpcional(160),

  interests: z.array(z.string().max(80)).max(10).default([]),
  otherInterest: textoOpcional(200),

  // `joined_at` é DATE no banco: `2026-08-29`, sem hora e sem fuso. Aceitar
  // qualquer string deixaria o Postgres interpretar "29/08/2026" à sua maneira.
  joinedAt: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "Data inválida." }),

  notes: textoOpcional(2000),
});

export type UpdateMemberInput = z.input<typeof updateMemberSchema>;
export type UpdateMemberData = z.output<typeof updateMemberSchema>;
