export type AuthErrorCode =
  | "invalidCredentials"
  | "passwordsDoNotMatch"
  | "emailAlreadyExists"
  | "generic";

export interface AuthActionState {
  error?: AuthErrorCode;
}

export const AUTH_INITIAL_STATE: AuthActionState = {};

/** Mensagens PT-BR para cada erro de autenticação. */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalidCredentials: "E-mail ou senha incorretos.",
  passwordsDoNotMatch: "As senhas não conferem.",
  emailAlreadyExists: "Este e-mail já está cadastrado.",
  generic: "Não foi possível concluir. Tente novamente.",
};
