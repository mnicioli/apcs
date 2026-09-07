import { ApcsMark } from "@/components/brand/apcs-logo";
import { CspiMark } from "@/components/brand/cspi-logo";
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
 * §6 e §7 — APCS + CSP no alto, e o usuário não tira.
 *
 * ⚠️ AS DUAS SÃO DESENHO, E O CSP ERA A PALAVRA "CSPI" ATÉ AGORA. O arquivo
 * dele não existia, e o comentário que estava aqui avisava que trocá-lo seria
 * mexer em dois lugares: este e a prévia do Builder. Foi exatamente o que
 * aconteceu — o porquê da marca mora em `CspiMark`.
 *
 * ⚠️ OS DOIS LOGOS ABREM EM OUTRA ABA, e a razão é o formulário. Esta página é
 * uma inscrição pela metade na maior parte do tempo que fica aberta: sair dela
 * no mesmo separador para ver o site institucional joga fora tudo o que a
 * pessoa já digitou, sem aviso e sem volta (o formulário não guarda rascunho).
 * `rel="noopener noreferrer"` acompanha o `target` sempre — sem ele, a página
 * de destino ganha uma referência de volta a esta.
 */
export function CabecalhoInstitucional() {
  return (
    <header className="border-hairline bg-card border-b">
      <div className="mx-auto flex max-w-[46rem] items-center justify-between gap-3 px-5 py-4">
        <LinkInstitucional>
          <ApcsMark height={32} />
        </LinkInstitucional>
        <LinkInstitucional>
          <CspiMark height={26} />
        </LinkInstitucional>
      </div>
    </header>
  );
}

/**
 * O envoltório dos dois logos.
 *
 * Existe para os dois terem o MESMO destino, o mesmo `rel` e o mesmo foco
 * visível — e para trocar qualquer uma das três coisas ser uma edição só. O
 * nome acessível vem do `alt` da imagem lá dentro, então o link não precisa (e
 * não deve) repetir um `aria-label`: um leitor de tela anunciaria duas vezes.
 *
 * ⚠️ `<a>` E NÃO `<Link>` DO NEXT. O destino é outro site. O `Link` existe para
 * navegação interna — ele faz prefetch e tenta uma transição de rota que aqui
 * não existe.
 */
function LinkInstitucional({ children }: { children: React.ReactNode }) {
  return (
    <a
      href={LANDING_INSTITUTIONAL_CONTEXT.website}
      target="_blank"
      rel="noopener noreferrer"
      className="focus:ring-ring/40 rounded focus:ring-2 focus:outline-none"
    >
      {children}
    </a>
  );
}

/**
 * O rodapé.
 *
 * ⚠️ UMA LINHA SÓ, ditada pelo cliente. Antes eram duas — a assinatura
 * "APCS · CSPI" e a razão social por extenso. As duas saíram juntas: o aviso de
 * direitos já nomeia as duas marcas, e repetir a razão social embaixo dele era
 * a mesma informação em dois pesos tipográficos.
 */
export function RodapeInstitucional() {
  return (
    <footer className="border-hairline text-muted-foreground border-t px-5 py-6 text-center text-xs">
      <p>{LANDING_INSTITUTIONAL_CONTEXT.copyright}</p>
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
