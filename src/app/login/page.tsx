import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { readRememberedEmail } from "@/lib/auth/remember";
import { AuthShell } from "@/components/layout/auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

/**
 * A TELA DE ENTRADA.
 *
 * ⚠️ É DINÂMICA, e de propósito: ela lê o cookie do e-mail lembrado para
 * preencher o campo já no HTML. A alternativa — ler no navegador depois da
 * pintura — mostraria o campo vazio por um instante e o preencheria sozinho na
 * cara de quem já estava digitando. E não se perde cache nenhum: o middleware
 * já consulta a sessão em toda requisição a `/login`, então esta página nunca
 * foi servida de um cache mesmo.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [emailLembrado, params] = await Promise.all([readRememberedEmail(), searchParams]);
  const senhaAlterada = params.senha === "alterada";

  return (
    <AuthShell
      title="Entrar no sistema"
      footer={
        <p className="text-sm">
          <Link href="/auth/forgot-password" className="text-primary-strong hover:underline">
            Esqueci minha senha
          </Link>
        </p>
      }
    >
      {/*
        A confirmação da troca de senha aparece AQUI, e não na tela anterior,
        porque `updatePasswordAction` termina deslogando: quem acabou de trocar
        chega neste formulário sem nenhum sinal de que deu certo. Sem esta
        linha, a experiência é "cliquei em salvar e fui parar no login" — que se
        parece com erro.
      */}
      {senhaAlterada && (
        <p
          role="status"
          className="border-primary/30 bg-accent text-primary-strong mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Senha alterada. Entre com a senha nova.
        </p>
      )}

      <LoginForm rememberedEmail={emailLembrado} />
    </AuthShell>
  );
}
