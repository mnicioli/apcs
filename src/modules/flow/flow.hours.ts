/**
 * O HORÁRIO DE ATENDIMENTO (§34 do Prompt 4) — lido de uma linha de texto que a
 * APCS escreve, e nunca de um `if` no código.
 *
 * ⚠️ POR QUE ISTO NÃO É UMA TABELA. A tentação era `attendance_hours` com uma
 * linha por dia da semana, tela de edição e migration. O §34 pede uma regra
 * configurável, e a pergunta que decide o formato é: quem edita isto, e com que
 * frequência? A resposta é "alguém da APCS, quando o expediente muda" — o que
 * acontece uma ou duas vezes por ano. Uma tabela com CRUD para dois eventos
 * anuais é infraestrutura que envelhece sem ser usada; uma linha de texto na
 * tela que já existe (`app_settings`) é editável hoje.
 *
 * ⚠️ O FORMATO É DELIBERADAMENTE ESTREITO:
 *
 *     seg-sex 08:00-18:00
 *     seg-sex 08:00-12:00, seg-sex 13:00-18:00
 *     seg-qui 08:00-18:00, sex 08:00-12:00
 *
 * Dias em PT-BR abreviado (`seg ter qua qui sex sab dom`), faixas separadas por
 * vírgula, intervalo de dias com hífen. Não há exceção de feriado, não há
 * "segunda a sexta exceto o dia 25". Feriado é um caso que precisa de calendário
 * — e um calendário meia-boca que erra o Carnaval é pior que não ter, porque
 * ninguém confere.
 *
 * ⚠️ E O QUE ELE PRODUZ É UMA VARIÁVEL, e não um desvio. `sys_horario_atendimento`
 * entra no contexto como "sim" ou "nao", e quem decide o que fazer com isso é
 * uma seta que o desenhador ligou — a mesma regra do §13 aplicada ao relógio.
 * O motor não tem um caminho secreto para fora do expediente.
 */

/** O fuso da APCS. O mesmo de `src/lib/utils.ts` e das migrations. */
const FUSO_APCS = "America/Sao_Paulo";

/**
 * A variável que o motor grava. Ver `FLOW_SYSTEM_VARIABLE_PREFIX`.
 *
 * ⚠️ "sim"/"nao" E NÃO "true"/"false", e o motivo é o operador que vai lê-la:
 * `is_true` (flow.operators.ts) aceita o conjunto fechado
 * `true,1,sim,s,yes,y` — os dois funcionam. O que decide é quem LÊ o desenho:
 * uma condição escrita `sys_horario_atendimento é verdadeiro` numa tela em
 * PT-BR, com o valor "sim" ao lado, se explica sozinha para quem não programa.
 */
export const BUSINESS_HOURS_VARIABLE = "sys_horario_atendimento";

/** Índice de `Date.getDay()`: 0 = domingo. */
const DIAS: Record<string, number> = {
  dom: 0,
  seg: 1,
  ter: 2,
  qua: 3,
  qui: 4,
  sex: 5,
  sab: 6,
};

const ORDEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

/** Uma faixa já interpretada: quais dias, de que hora a que hora. */
export interface BusinessWindow {
  /** Índices de `getDay()`. */
  days: number[];
  /** Minutos desde a meia-noite. */
  startMinutes: number;
  endMinutes: number;
}

function minutos(hhmm: string): number | null {
  const casou = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!casou) return null;

  const hora = Number(casou[1]);
  const minuto = Number(casou[2]);
  if (!Number.isInteger(hora) || !Number.isInteger(minuto)) return null;
  if (hora > 23 || minuto > 59) return null;

  return hora * 60 + minuto;
}

/** `seg-sex` → [1,2,3,4,5]; `sab` → [6]. */
function diasDaFaixa(bruto: string): number[] | null {
  const texto = bruto.trim().toLowerCase();

  const intervalo = /^([a-z]{3})-([a-z]{3})$/.exec(texto);
  if (intervalo) {
    const de = intervalo[1];
    const ate = intervalo[2];
    if (de === undefined || ate === undefined) return null;

    const inicio = ORDEM.indexOf(de as (typeof ORDEM)[number]);
    const fim = ORDEM.indexOf(ate as (typeof ORDEM)[number]);
    if (inicio < 0 || fim < 0) return null;

    // ⚠️ O INTERVALO DÁ A VOLTA. `sex-seg` é sexta, sábado, domingo e segunda —
    // e é um expediente real (plantão de fim de semana). Recusá-lo obrigaria a
    // escrever duas faixas para dizer uma coisa.
    const dias: number[] = [];
    let atual = inicio;
    for (let passo = 0; passo <= ORDEM.length; passo += 1) {
      dias.push(atual);
      if (atual === fim) return dias;
      atual = (atual + 1) % ORDEM.length;
    }
    return null;
  }

  const unico = DIAS[texto];
  return unico === undefined ? null : [unico];
}

/**
 * Lê a configuração. Uma faixa ilegível é DESCARTADA, e as outras valem.
 *
 * ⚠️ DESCARTAR EM VEZ DE RECUSAR TUDO é a escolha certa aqui pelo mesmo motivo
 * de `chatbotEnabled` falhar-aberto: quem digitar `seg-sex 08:00-18:00, sabado
 * 09:00-13:00` (o dia por extenso, que o formato não aceita) não deve perder o
 * expediente da semana inteira por causa da segunda faixa. Perde aquela, e a
 * próxima leitura da tela mostra o que sobrou.
 *
 * ⚠️ E A HORA É TOLERANTE COM O ZERO À ESQUERDA: `8:00` e `08:00` são a mesma
 * coisa. O campo é uma caixa de texto preenchida por uma pessoa, e recusar um
 * caractere que não gera ambiguidade nenhuma seria rigor sem benefício. O que
 * NÃO se adivinha é o que tem duas leituras plausíveis — ver a faixa invertida
 * mais abaixo.
 *
 * ⚠️ TEXTO VAZIO DEVOLVE LISTA VAZIA, e quem chama decide o que isso significa —
 * ver `isWithinBusinessHours`.
 */
export function parseBusinessHours(spec: string): BusinessWindow[] {
  const janelas: BusinessWindow[] = [];

  for (const pedaco of spec.split(",")) {
    const partes = pedaco.trim().split(/\s+/);
    if (partes.length !== 2) continue;

    const [diasBrutos, horasBrutas] = partes;
    if (diasBrutos === undefined || horasBrutas === undefined) continue;

    const dias = diasDaFaixa(diasBrutos);
    if (!dias) continue;

    const horas = horasBrutas.split("-");
    if (horas.length !== 2) continue;

    const [deBruto, ateBruto] = horas;
    if (deBruto === undefined || ateBruto === undefined) continue;

    const de = minutos(deBruto);
    const ate = minutos(ateBruto);
    if (de === null || ate === null) continue;

    // ⚠️ FAIXA QUE NÃO AVANÇA É DESCARTADA. `18:00-08:00` não é "das seis da
    // tarde às oito da manhã do dia seguinte": é um erro de digitação com uma
    // leitura plausível, e adivinhar qual das duas a pessoa quis dizer é pior
    // que ignorar a linha.
    if (ate <= de) continue;

    janelas.push({ days: dias, startMinutes: de, endMinutes: ate });
  }

  return janelas;
}

/** Dia da semana e minutos do dia, no fuso da APCS. */
export function nowInBusinessTimezone(agora: Date = new Date()): {
  day: number;
  minutes: number;
} {
  // `en-CA` com `hour12: false` devolve "14:05"; o dia vem do `weekday` curto em
  // inglês, que é estável e não depende de locale instalado.
  const formatador = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_APCS,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const partes = formatador.formatToParts(agora);
  const weekday = partes.find((p) => p.type === "weekday")?.value ?? "";
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  const minuto = Number(partes.find((p) => p.type === "minute")?.value ?? "0");

  const semana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dia = semana.indexOf(weekday);

  return {
    day: dia < 0 ? 0 : dia,
    // `hour12: false` produz "24" à meia-noite em algumas plataformas.
    minutes: (hora % 24) * 60 + minuto,
  };
}

/**
 * Estamos dentro do expediente?
 *
 * ⚠️ SEM CONFIGURAÇÃO, A RESPOSTA É `true`, e a escolha tem lado. As duas
 * falhas possíveis não custam o mesmo:
 *
 *   dizer que está ABERTO quando está fechado  → a pessoa é transferida e
 *                                                espera até de manhã. Ruim.
 *   dizer que está FECHADO quando está aberto  → a pessoa recebe "voltamos
 *                                                amanhã" com o time inteiro
 *                                                sentado à mesa. Pior: ela vai
 *                                                embora, e ninguém fica sabendo.
 *
 * A ausência de configuração precisa significar o comportamento de antes de o
 * campo existir — que era não ter horário nenhum, ou seja, sempre atender. É o
 * mesmo raciocínio de `chatbotEnabled`.
 */
export function isWithinBusinessHours(spec: string, agora: Date = new Date()): boolean {
  const janelas = parseBusinessHours(spec);
  if (janelas.length === 0) return true;

  const { day, minutes } = nowInBusinessTimezone(agora);

  return janelas.some(
    (janela) =>
      janela.days.includes(day) && minutes >= janela.startMinutes && minutes < janela.endMinutes,
  );
}
