import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INTELLIGENCE_OUTCOME_LABELS } from "@/modules/intelligence/intelligence.labels";
import { INTENT_REGISTRY } from "@/modules/intelligence/intent.registry";
import { isIntentName } from "@/modules/intelligence/intent.types";
import { computeRates } from "@/modules/intelligence/metrics.types";
import type {
  IntelligenceDailyMetrics,
  IntelligenceIntentTotal,
  UnknownQuestion,
} from "@/modules/intelligence/metrics.types";

/**
 * §34 a §37, §76. O PAINEL DO ROBÔ.
 *
 * ⚠️ ELE EXISTE PARA UMA PERGUNTA SÓ: o que falta cadastrar? As três taxas de
 * cima dizem se há problema; a lista de baixo diz qual é, com as palavras que
 * as pessoas usaram.
 *
 * ⚠️ E ELE NÃO É UM DASHBOARD. Não há gráfico, não há filtro de período, não há
 * comparação com o mês passado. O §76 pede que os DADOS estejam prontos para um
 * dashboard futuro — e estão, nas três views. Construir os gráficos agora seria
 * desenhar em cima de números que ninguém ainda olhou uma vez.
 */

function pct(valor: number | null): string {
  return valor === null ? "—" : `${Math.round(valor * 100)}%`;
}

function Numero({ rotulo, valor, ajuda }: { rotulo: string; valor: string; ajuda?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{rotulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
      {ajuda && <p className="text-muted-foreground text-xs">{ajuda}</p>}
    </div>
  );
}

export function ChatbotMetrics({
  dias,
  intencoes,
  perguntas,
}: {
  dias: IntelligenceDailyMetrics[];
  intencoes: IntelligenceIntentTotal[];
  perguntas: UnknownQuestion[];
}) {
  const taxas = computeRates(dias);

  if (taxas.turnos === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acompanhamento</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {/* ⚠️ "SEM DADOS" PRECISA SER DIFERENTE DE "TUDO ZERO". Um painel de
              zeros faria parecer que o robô está falhando em tudo, quando ele
              simplesmente ainda não atendeu ninguém. */}
          O robô ainda não atendeu ninguém nos últimos 30 dias. Quando atender, os números aparecem
          aqui.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Acompanhamento — últimos 30 dias</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Numero rotulo="Conversas" valor={String(taxas.conversas)} />
          <Numero rotulo="Turnos" valor={String(taxas.turnos)} />
          <Numero
            rotulo="Identificação"
            valor={pct(taxas.identificacao)}
            ajuda="entendeu o pedido"
          />
          <Numero rotulo="Encaminhamento" valor={pct(taxas.handoff)} ajuda="foi para uma pessoa" />
          <Numero rotulo="Erro" valor={pct(taxas.erro)} ajuda="falha de consulta" />
          <Numero
            rotulo="Resposta"
            valor={taxas.latenciaMediaMs === null ? "—" : `${taxas.latenciaMediaMs} ms`}
            ajuda={
              taxas.tokensPorClassificacao === null
                ? undefined
                : `~${taxas.tokensPorClassificacao} tokens por classificação`
            }
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>O que pedem</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="pb-2 font-medium">Intenção</th>
                    <th className="pb-2 text-right font-medium">Turnos</th>
                    <th className="pb-2 text-right font-medium">Entregou</th>
                    <th className="pb-2 text-right font-medium">Sem conteúdo</th>
                  </tr>
                </thead>
                <tbody>
                  {intencoes.map((linha) => (
                    <tr key={linha.intent} className="border-border/60 border-t">
                      <td className="py-2">
                        {isIntentName(linha.intent)
                          ? INTENT_REGISTRY[linha.intent].label
                          : linha.intent}
                      </td>
                      <td className="py-2 text-right tabular-nums">{linha.turnos}</td>
                      <td className="py-2 text-right tabular-nums">{linha.entregas}</td>
                      {/* ⚠️ ESTA COLUNA É A QUE PEDE AÇÃO. Uma intenção com muitos
                          turnos e muito "sem conteúdo" é gente pedindo algo que a
                          APCS não publicou — não é defeito do robô. */}
                      <td className="py-2 text-right tabular-nums">{linha.sem_conteudo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Perguntas sem resposta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              O que as pessoas perguntaram e o robô não respondeu. Cada uma destas é uma entrada
              possível na Base de Conhecimento.
            </p>

            {perguntas.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma nos últimos 30 dias — o robô respondeu tudo que perguntaram.
              </p>
            ) : (
              <ul className="space-y-2">
                {perguntas.map((item) => (
                  <li
                    key={item.id}
                    className="border-border/60 border-t pt-2 text-sm first:border-0"
                  >
                    <p className="break-words">{item.pergunta}</p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(item.created_at).toLocaleDateString("pt-BR")} ·{" "}
                      {INTELLIGENCE_OUTCOME_LABELS[item.outcome]}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
