import type { Metadata } from "next";
import Image from "next/image";
import { APP_NAME } from "@/config/app";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      */}
      <div
        aria-hidden
        className="bg-background/85 lg:landscape:from-background lg:landscape:via-background/90 absolute inset-0 lg:landscape:bg-transparent lg:landscape:bg-gradient-to-r lg:landscape:to-transparent"
      />

      <Card className="relative w-full max-w-sm shadow-lg lg:landscape:ml-[6vw]">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{APP_NAME}</CardTitle>
          <CardDescription>Entre com seu e-mail e senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
