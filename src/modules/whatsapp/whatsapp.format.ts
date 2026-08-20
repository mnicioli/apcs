/**
 * Como a caixa de entrada escreve data e hora.
 *
 * Fica no módulo, e não na tela, por dois motivos: é função pura (então é
 * testável sem renderizar nada) e a MESMA resposta é usada em três lugares —
 * o separador de dia na transcrição, a hora dentro da bolha e a coluna da
 * direita na lista de conversas.
 *
 * ⚠️ TUDO NO FUSO DE SÃO PAULO, EXPLICITAMENTE. Sem `timeZone`, o `Intl` usa o
 * relógio do SERVIDOR — que na Vercel é UTC. Das 21h à meia-noite, uma mensagem
 * recebida "hoje" apareceria sob o separador de amanhã.
 */

const TZ = "America/Sao_Paulo";

/**
 * Chave do dia, AAAA-MM-DD. `en-CA` é o único locale que o Intl formata em ISO,
 * o que dá uma chave ordenável sem montar a string à mão. Mesmo truque de
 * `todayInSaoPaulo` em `src/lib/utils.ts`.
 */
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const clockFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** O dia a que uma mensagem pertence. É por ele que o separador é agrupado. */
export function whatsappDayKey(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "" : dayKeyFormatter.format(data);
}

/** `14:32`. Vai dentro da bolha, ao lado do visto de entrega. */
export function whatsappClock(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "" : clockFormatter.format(data);
}

/**
 * O separador de dia: "Hoje", "Ontem" ou a data.
 *
 * ⚠️ A COMPARAÇÃO É POR CHAVE DE DIA, não por diferença de horas. "Faz menos de
 * 24 h" não é "hoje": às 8h da manhã, uma mensagem de ontem às 22h teria 10
 * horas de idade e cairia sob o separador errado.
 */
export function whatsappDayLabel(iso: string, now: Date = new Date()): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";

  const chave = dayKeyFormatter.format(data);
  const hoje = dayKeyFormatter.format(now);
  if (chave === hoje) return "Hoje";

  const ontem = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (chave === dayKeyFormatter.format(ontem)) return "Ontem";

  return dayFormatter.format(data);
}

/**
 * O carimbo da coluna direita na LISTA de conversas — onde só cabem poucos
 * caracteres. Hoje mostra a hora; ontem, "ontem"; antes disso, a data.
 *
 * É o comportamento do próprio WhatsApp, e não é imitação gratuita: numa lista
 * de sessenta linhas, "14:32" e "12/08/2026" ocupando a mesma coluna é o que
 * permite ver de relance o que é de hoje.
 */
export function whatsappListStamp(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const rotulo = whatsappDayLabel(iso, now);
  if (rotulo === "Hoje") return whatsappClock(iso);
  if (rotulo === "Ontem") return "ontem";
  return rotulo;
}

/** `1,4 MB`. Aparece no anexo, onde o tamanho decide se vale baixar agora. */
export function whatsappFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** `1:07` para um áudio de 67 segundos. */
export function whatsappDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "";
  const minutos = Math.floor(seconds / 60);
  const resto = Math.floor(seconds % 60);
  return `${minutos}:${String(resto).padStart(2, "0")}`;
}
