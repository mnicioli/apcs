export type AuthErrorCode =
  | "invalidCredentials"
  | "passwordsDoNotMatch"
  | "emailAlreadyExists"
  | "weakPassword"
  | "invalidEmail"
  | "tooManyRequests"
  | "recoveryLinkInvalid"
  | "samePassword"
  | "generic";

export interface AuthActionState {
  error?: AuthErrorCode;
  /**
   * O pedido de recuperação foi aceito.
   *
   * ⚠️ NÃO SIGNIFICA "existe uma conta com esse e-mail", e a mensagem que o
   * acompanha também não pode sugerir isso — ver `requestPasswordResetAction`.
   */
  sent?: boolean;
  /** A senha nova foi gravada. */
  done?: boolean;
}

export const AUTH_INITIAL_STATE: AuthActionState = {};

/** Mensagens PT-BR para cada erro de autenticação. */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalidCredentials: "E-mail ou senha incorretos.",
  passwordsDoNotMatch: "As senhas não conferem.",
  emailAlreadyExists: "Este e-mail já está cadastrado.",
  weakPassword: "A senha precisa ter pelo menos 8 caracteres.",
  invalidEmail: "Digite um e-mail válido.",
  // O limite é do Supabase, não nosso: ele barra o reenvio em sequência para o
  // mesmo e-mail. Dizer "aguarde um minuto" evita que a pessoa clique dez vezes
  // achando que o botão está quebrado.
  tooManyRequests: "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.",
  recoveryLinkInvalid:
    "Este link de recuperação expirou ou já foi usado. Peça um novo para continuar.",
  samePassword: "A senha nova precisa ser diferente da anterior.",
  generic: "Não foi possível concluir. Tente novamente.",
};

/** Confirmação neutra do pedido de recuperação. Ver a decisão em `actions.ts`. */
export const AUTH_RESET_SENT_MESSAGE =
  "Se houver uma conta com esse e-mail, o link de recuperação chega em instantes. " +
  "Confira também a caixa de spam.";
