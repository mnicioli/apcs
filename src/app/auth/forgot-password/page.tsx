import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/types";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // `?erro=link` é como `/auth/callback` avisa que o link do e-mail não valeu.
  const linkInvalido = params.erro === "link";

  return (
    <AuthShell
      title="Recuperar senha"
      description="Informe o e-mail da sua conta. Enviamos um link para você definir uma senha nova."
      footer={
        <p className="text-sm">
          <Link href="/login" className="text-primary-strong hover:underline">
            Voltar para entrar
          </Link>
        </p>
      }
    >
      {linkInvalido && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-md border px-3 py-2 text-sm"
        >
          {AUTH_ERROR_MESSAGES.recoveryLinkInvalid}
        </p>
      )}

      <ForgotPasswordForm />
    </AuthShell>
  );
}
