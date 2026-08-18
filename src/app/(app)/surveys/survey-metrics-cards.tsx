import type { SurveyMetrics } from "@/modules/survey/survey.types";
import { Card, CardContent } from "@/components/ui/card";

/**
 * OS NÚMEROS DA CAMPANHA (§42, §45).
 *
 * ⚠️ Os quatro estados de entrega aparecem MESMO ZERADOS, e é decisão. Hoje
 * ninguém envia nada (não há integração de WhatsApp — ver GAP 2 em
 * docs/ENQUETES.md), então "Enviados: 0" é o estado verdadeiro do sistema.
 * Esconder os cards enquanto forem zero faria a tela parecer completa e
 * mandaria alguém descobrir a lacuna só quando cobrasse os números.
 *
 * O rodapé explica o zero em vez de deixá-lo mudo.
 */
export function SurveyMetricsCards({
  metrics,
  className,
}: {
  metrics: SurveyMetrics;
  className?: string;
}) {
  const semEnvio = metrics.totalSent === 0 && metrics.totalAudience > 0;

  return (
    <div className={className}>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Público"
          value={metrics.totalAudience}
          hint="Contatos fotografados no agendamento."
        />
        <Metric label="Enviados" value={metrics.totalSent} />
        <Metric label="Entregues" value={metrics.totalDelivered} />
        <Metric label="Lidos" value={metrics.totalRead} />
        <Metric label="Respostas" value={metrics.totalResponses} destaque />
        <Metric
          label="Taxa de participação"
          value={`${formatarPercentual(metrics.participationRate)}%`}
          hint="Respostas sobre mensagens entregues."
          destaque
        />
        <Metric label="Erros" value={metrics.totalErrors} alerta={metrics.totalErrors > 0} />
      </dl>

      {semEnvio && (
        <p className="text-muted-foreground mt-3 text-xs">
          Envio, entrega e leitura ficam em zero porque o disparo por WhatsApp ainda não está
          integrado — o público já está registrado e as respostas continuam sendo contadas.
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  destaque = false,
  alerta = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        {/* `dt` antes de `dd` no DOM, mas o número é o que salta: a hierarquia
            visual é do tamanho, não da ordem. */}
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd
          className={
            alerta
              ? "text-destructive text-2xl font-semibold tabular-nums"
              : destaque
                ? "text-primary-strong text-2xl font-semibold tabular-nums"
                : "text-2xl font-semibold tabular-nums"
          }
        >
          {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
        </dd>
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * O percentual em português: vírgula decimal, e sem casas quando é redondo.
 *
 * "35,2%" e "100%" — nunca "100,00%", que sugere uma precisão que a conta não
 * tem, nem "35.2%", que não é como se escreve número aqui.
 */
export function formatarPercentual(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}
