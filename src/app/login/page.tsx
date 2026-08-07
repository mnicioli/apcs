import type { Metadata } from "next";
import Image from "next/image";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh items-center px-4 py-10 sm:px-8">
      {/*
        Arte institucional da APCS. `alt` vazio de propósito: a imagem é
        decorativa e nada nela é informação que o formulário já não dê — um
        leitor de tela anunciando "dois suínos" antes do campo de e-mail só
        atrapalharia.

        `priority` porque é o maior elemento do primeiro paint. Sem isso ela
        entra depois do formulário e a tela pisca branca no meio do caminho.
      */}
      <Image
        src="/login-bg.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        // O assunto da arte está à direita. Enquadrar por ali evita que telas
        // estreitas cortem justo nos suínos e mostrem só o vazio da esquerda.
        className="object-cover object-[70%_center]"
      />

      {/*
        Véu de legibilidade, em duas versões.

        O gradiente direcional só funciona quando a arte cabe mais ou menos
        inteira: aí ela mantém o vazio à esquerda que o designer deixou, e o
        véu clareia exatamente essa faixa, preservando os suínos e a onda
        vermelha à direita.

        Em retrato o `object-cover` amplia muito para preencher a altura, e o
        assunto é empurrado para dentro da área do formulário — medido em
        768x1024, os suínos chegam a 265px, sob o cartão. Por isso a condição é
        `landscape`, não largura: um tablet em pé tem 768px de largura e ainda
        assim precisa do véu chapado. Legibilidade ganha da estética quando as
        duas não cabem.

        O chapado é 70%, não 85%: a arte já é clara, e a 85% ela desaparecia por
        completo no celular — sobrava um creme liso e uma imagem baixada à toa.
        O cartão é opaco, então o véu não responde pela legibilidade do
        formulário; ele só evita que o entorno fique ruidoso.

        As PARADAS do gradiente são explícitas pelo mesmo motivo. No padrão
        (0% → 50% → 100%) ele ainda estava a 90% no meio da tela, e os suínos
        ocupam de 54% a 98% da largura: some tudo. Aqui ele fica sólido até 30%,
        onde o cartão está, e zera em 70% — antes de onde a arte tem assunto.
      */}
      <div
        aria-hidden
        className="bg-background/70 lg:landscape:from-background lg:landscape:via-background/50 absolute inset-0 lg:landscape:bg-transparent lg:landscape:bg-gradient-to-r lg:landscape:from-30% lg:landscape:via-55% lg:landscape:to-transparent lg:landscape:to-70%"
      />

      <Card className="relative w-full max-w-sm shadow-lg lg:landscape:ml-[6vw]">
        <CardContent className="p-6">
          <div className="mb-6 text-center">
            {/*
              `unoptimized`: o otimizador do Next recusa SVG por padrão (é um
              formato executável), e ligar `dangerouslyAllowSVG` abriria a porta
              para QUALQUER SVG remoto. Este arquivo é nosso e estático — servir
              direto de /public é mais seguro e não perde nada, já que vetor não
              tem o que otimizar por resolução.
            */}
            <Image
              src="/logo-apcs.svg"
              alt="APCS"
              width={144}
              height={78}
              priority
              unoptimized
              className="mx-auto h-auto w-36"
            />
            {/*
              `h1` em vez de `CardTitle`: esta é a única headline da página, e
              `CardTitle` renderiza `h3` fixo. Um documento que começa em h3
              deixa quem navega por cabeçalhos sem âncora de topo.
            */}
            <h1 className="mt-3 text-xl font-semibold tracking-tight">Entrar no sistema</h1>
          </div>

          <LoginForm />

          <div className="border-border mt-6 border-t pt-4">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Acesso restrito à equipe da APCS.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
