import type { Metadata } from "next";
import Link from "next/link";
import { listNotificationBlocks } from "@/lib/services/admin";
import { formatDateTime } from "@/lib/utils";
import { formatWhatsapp } from "@/modules/membership/membership.schema";
import { memberHref } from "@/modules/membership/membership.routes";
import type { RawSearchParams } from "@/modules/membership/membership.routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ResumeBlockButton } from "./resume-block-button";

export const metadata: Metadata = { title: "Bloqueios — Configurações" };

/**
 * QUEM PEDIU PARA NÃO RECEBER.
 *
 * A ficha do associado já mostrava isso de um em um. A lista responde outra
 * pergunta: "quantos saíram, e quando?" — que é a única forma de perceber que
 * uma divulgação afastou trinta pessoas de uma vez.
 *
 * ⚠️ O TELEFONE APARECE MASCARADO na coluna, e inteiro só quando há associado
 * (aí o nome já identifica a pessoa de qualquer jeito). Esta é uma tela de
 * administração, não de atendimento: quem precisa do número para falar com
 * alguém tem a ficha e a caixa de entrada.
 *
 * ⚠️ OS REVOGADOS APARECEM QUANDO PEDIDO, e não somem para sempre. Uma lista
 * que escondesse quem voltou a receber não teria como responder "quem foi
 * reativado, e a pedido de quem?" — que é a pergunta que a nota de reativação
 * existe para responder.
 */
export default async function SettingsNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const mostrarRevogados = params.revoked === "1";
  const pagina = Number(Array.isArray(params.page) ? params.page[0] : (params.page ?? "1")) || 1;

  const lista = await listNotificationBlocks(pagina, mostrarRevogados);
  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {lista.total === 0
            ? "Ninguém pediu para parar de receber."
            : `${lista.total} ${lista.total === 1 ? "registro" : "registros"}.`}{" "}
          O bloqueio é do TELEFONE, não do cadastro — um número compartilhado bloqueia todos que o
          usam.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href={mostrarRevogados ? "/settings/notifications" : "?revoked=1"}>
            {mostrarRevogados ? "Ver só os que valem" : "Incluir os desfeitos"}
          </Link>
        </Button>
      </div>

      {lista.rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Nenhum bloqueio.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Quem responde SAIR a uma mensagem da APCS aparece aqui.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-border text-muted-foreground border-b text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Quem</th>
                    <th className="px-4 py-3 font-medium">Telefone</th>
                    <th className="px-4 py-3 font-medium">Pediu em</th>
                    <th className="px-4 py-3 font-medium">Por onde</th>
                    <th className="px-4 py-3 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.rows.map((bloqueio) => (
                    <tr
                      key={bloqueio.id}
                      className="border-border hover:bg-muted/50 border-b last:border-0"
                    >
                      <td className="px-4 py-3">
                        {bloqueio.memberId ? (
                          <Link
                            href={memberHref(bloqueio.memberId)}
                            className="font-medium hover:underline"
                          >
                            {bloqueio.memberName ?? "Associado"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {bloqueio.contactName ?? "Não identificado"}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 font-mono text-xs">
                        {/* Inteiro quando o nome já identifica; mascarado quando
                            não — ver o cabeçalho. */}
                        {bloqueio.phoneKey
                          ? bloqueio.memberId
                            ? formatWhatsapp(bloqueio.phoneKey)
                            : `•••• ${bloqueio.phoneKey.slice(-4)}`
                          : "—"}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {formatDateTime(bloqueio.createdAt)}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {bloqueio.source === "chatbot" ? "Respondeu SAIR" : "Registrado pelo time"}
                      </td>
                      <td className="px-4 py-3">
                        {bloqueio.revokedAt ? (
                          <div>
                            <Badge variant="done">Voltou a receber</Badge>
                            {bloqueio.revokedNote && (
                              <span className="text-muted-foreground mt-1 block text-xs">
                                {bloqueio.revokedNote}
                              </span>
                            )}
                          </div>
                        ) : (
                          <ResumeBlockButton blockId={bloqueio.id} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {totalPaginas > 1 && (
        <nav aria-label="Paginação" className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Página {lista.page} de {totalPaginas}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild disabled={lista.page <= 1}>
              <Link href={paginaHref(lista.page - 1, mostrarRevogados)}>Anterior</Link>
            </Button>
            <Button variant="outline" size="sm" asChild disabled={lista.page >= totalPaginas}>
              <Link href={paginaHref(lista.page + 1, mostrarRevogados)}>Próxima</Link>
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

function paginaHref(pagina: number, revogados: boolean): string {
  const query = new URLSearchParams();
  if (pagina > 1) query.set("page", String(Math.max(1, pagina)));
  if (revogados) query.set("revoked", "1");
  const texto = query.toString();
  return texto ? `/settings/notifications?${texto}` : "/settings/notifications";
}
