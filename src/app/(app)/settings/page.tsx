import type { Metadata } from "next";
import Link from "next/link";
import { getWhatsAppIntegrationStatus } from "@/lib/services/admin";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Integração — Configurações" };

/**
 * O DIAGNÓSTICO DA INTEGRAÇÃO DE WHATSAPP.
 *
 * ⚠️ ESTA TELA NÃO CONFIGURA NADA, E É DE PROPÓSITO. As credenciais da Z-API
 * vivem em variável de ambiente e continuam lá: uma caixa de texto para colar o
 * token no banco transformaria uma tabela comum na coisa mais sensível do
 * sistema — legível por qualquer caminho que leia aquela tabela, presente em
 * todo backup, e fora do controle de quem administra o deploy.
 *
 * ⚠️ CADA NÚMERO VEM DE UM FATO, não de uma configuração. "Configurado" só diz
 * que as variáveis existem. Quem prova que o webhook chega é a última mensagem
 * que ENTROU; quem prova que o envio funciona é a última que SAIU. É a
 * diferença entre "deveria estar no ar" e "está" — e é a pergunta que se faz
 * quando alguém avisa que não recebeu a divulgação.
 */
export default async function SettingsIntegrationPage() {
  const status = await getWhatsAppIntegrationStatus();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {status.configured ? (
              <Badge variant="done">Configurado</Badge>
            ) : (
              <Badge variant="alert">Não configurado</Badge>
            )}
            <span className="text-muted-foreground">
              Fornecedor: <span className="font-mono">{status.provider}</span>
            </span>
          </div>

          {!status.configured && (
            <div className="border-border bg-muted/40 rounded-lg border px-3 py-2">
              <p className="font-medium">Nada entra nem sai por aqui.</p>
              <p className="text-muted-foreground mt-1">
                Faltam estas variáveis de ambiente:{" "}
                {/* ⚠️ Só o NOME da variável, nunca o valor. Uma tela de
                    diagnóstico que imprime segredo é um vazamento com print
                    de tela. */}
                <span className="font-mono">{status.missing.join(", ")}</span>. Elas são definidas
                onde o sistema está hospedado, não aqui.
              </p>
            </div>
          )}

          <dl className="divide-border divide-y">
            <Linha
              rotulo="Última mensagem recebida"
              valor={status.lastInboundAt ? formatDateTime(status.lastInboundAt) : "Nenhuma"}
              dica="Prova que o webhook está chegando. Sem isso, respostas e pedidos de SAIR não entram."
            />
            <Linha
              rotulo="Última mensagem enviada"
              valor={status.lastOutboundAt ? formatDateTime(status.lastOutboundAt) : "Nenhuma"}
              dica="Prova que o envio funciona."
            />
            <Linha
              rotulo="Falhas de envio (24 h)"
              valor={String(status.failedLast24h)}
              dica={
                status.failedLast24h > 0
                  ? "Mensagens que saíram e não chegaram. Vale abrir a conversa e conferir o número."
                  : "Nenhuma mensagem falhou no último dia."
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alcance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="text-2xl font-semibold">{status.activeBlocks}</span>{" "}
            <span className="text-muted-foreground">
              {status.activeBlocks === 1 ? "telefone bloqueado" : "telefones bloqueados"}
            </span>
          </p>
          <p className="text-muted-foreground">
            Números que pediram para não receber mensagens da APCS. Eles são pulados em toda
            divulgação de evento e em toda enquete.
          </p>
          <Link href="/settings/notifications" className="text-primary text-sm hover:underline">
            Ver a lista
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function Linha({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="py-2.5">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
      {dica && <p className="text-muted-foreground mt-0.5 text-xs">{dica}</p>}
    </div>
  );
}
