import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasRecovery } from "@/lib/auth/recovery";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/types";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Definir nova senha" };

/**
 * DEFINIR A SENHA NOVA.
 *
 * ⚠️ EXIGE AS DUAS COISAS: a sessão criada pelo link E o cookie de recuperação.
 * Só a sessão não basta — qualquer aba logada teria uma, e trocar senha sem
 * provar quem se é não pode depender de um computador destravado. O porquê
 * inteiro está em `lib/auth/recovery.ts`.
 *
 * Quem chega sem os dois não vê formulário nenhum: vê o caminho para pedir
 * outro link, que é a única coisa útil a fazer daqui.
 */
export default async function ResetPasswordPage() {
  const [usuario, veioDoLink] = await Promise.all([getCurrentUser(), hasRecovery()]);
  const podeTrocar = Boolean(usuario) && veioDoLink;

  return (
    <AuthShell
      title="Definir nova senha"
      description={podeTrocar ? `Escolha a senha nova da conta ${usuario?.email}.` : undefined}
      footer={
        <p className="text-sm">
          <Link
            href={podeTrocar ? "/login" : "/auth/forgot-password"}
            className="text-primary-strong hover:underline"
          >
            {podeTrocar ? "Voltar para entrar" : "Pedir um novo link"}
          </Link>
        </p>
      }
    >
      {podeTrocar ? (
        <ResetPasswordForm />
      ) : (
        <p role="alert" className="text-muted-foreground text-sm">
          {AUTH_ERROR_MESSAGES.recoveryLinkInvalid}
        </p>
      )}
    </AuthShell>
  );
}
