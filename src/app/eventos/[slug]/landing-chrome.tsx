import { ApcsMark } from "@/components/brand/apcs-logo";
import { APP_LEGAL_NAME } from "@/config/app";
import {
  LANDING_INSTITUTIONAL_CONTEXT,
  PUBLIC_LANDING_COPY,
} from "@/modules/event/event.landing.labels";

/**
 * As partes da página pública que não dependem de estado: a identidade
 * institucional e o aviso que substitui o formulário quando ele não vale.
 *
 * ⚠️ SEM `"use client"`, E É POR ISSO QUE ELE FICA NUM ARQUIVO SÓ. Estas peças
 * são usadas pela PÁGINA (Server Component, que decide no servidor se as
 * inscrições estão abertas — §29) e pelo FORMULÁRIO (Client Component, que pode
 * descobrir a mesma coisa depois, quando o banco recusa um envio que a tela
 * achava possível). Sem hook e sem import de servidor, o mesmo componente serve
 * aos dois — e o aviso de "vagas esgotadas" é literalmente o mesmo nos dois
 * caminhos, em vez de duas versões que divergem.
 */

/**
 * §6 e §7 — APCS + CSPI no alto, e o usuário não tira.
 *
 * ⚠️ O CSPI APARECE COMO ASSINATURA TIPOGRÁFICA, E NÃO COMO LOGO, PORQUE O
 * ARQUIVO NÃO EXISTE. `public/` tem `logo-apcs.svg` e mais nada. Desenhar um
 * substituto seria inventar a marca de terceiro; deixar um espaço vazio seria
 * fingir que está resolvido. É a MESMA decisão (e o mesmo desenho) da prévia do
 * Builder — quando o SVG chegar, são dois lugares para trocar, e este comentário
 * está nos dois. Ver docs/INSCRICOES.md.
 */
export function CabecalhoInstitucional() {
  return (
    <header className="border-hairline bg-card border-b">
      <div className="mx-auto flex max-w-[46rem] items-center justify-between gap-3 px-5 py-4">
        <ApcsMark height={32} />
        <span className="text-primary-strong text-xs font-semibold tracking-[0.18em] uppercase">
          {LANDING_INSTITUTIONAL_CONTEXT.program}
        </span>
      </div>
    </header>
  );
}

export function RodapeInstitucional() {
  return (
    <footer className="border-hairline text-muted-foreground border-t px-5 py-6 text-center text-xs">
      <p className="font-medium">{LANDING_INSTITUTIONAL_CONTEXT.signature}</p>
      <p className="mt-1">{APP_LEGAL_NAME}</p>
    </footer>
  );
}

/**
 * §27 e §28 — o que fica no lugar do formulário.
 *
 * Duas causas, um desenho: as inscrições não estão abertas, e a página do
 * evento continua lá para quem quiser saber quando e onde é. `soldOut` e
 * `closed` são separados porque as frases são diferentes — "esgotou" e
 * "encerrou" pedem reações diferentes de quem lê.
 *
 * ⚠️ NENHUMA DAS DUAS EXPLICA A MECÂNICA. Não dizem quantas vagas havia nem em
 * que dia o prazo venceu: é uma página aberta na internet, e o §30 proíbe
 * expor o funcionamento interno.
 */
export function AvisoInscricoesFechadas({ motivo }: { motivo: "closed" | "soldOut" }) {
  const esgotado = motivo === "soldOut";

  return (
    <div
      role="status"
      className="border-hairline bg-surface rounded-2xl border px-6 py-8 text-center"
    >
      <h2 className="font-display text-primary-strong text-xl font-extrabold tracking-tight uppercase">
        {esgotado ? PUBLIC_LANDING_COPY.soldOutTitle : PUBLIC_LANDING_COPY.closedTitle}
      </h2>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {esgotado ? PUBLIC_LANDING_COPY.soldOutMessage : PUBLIC_LANDING_COPY.closedMessage}
      </p>
    </div>
  );
}
