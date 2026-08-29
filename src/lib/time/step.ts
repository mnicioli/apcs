/**
 * O PASSO DO RELÓGIO — de cinco em cinco minutos, no sistema inteiro.
 *
 * Eventos, Palestras e Enquetes marcam horário, e antes cada um oferecia os
 * sessenta minutos. Rolar uma lista de sessenta para achar "14:00" é trabalho
 * inventado: a APCS não marca reunião às 14h07.
 *
 * ⚠️ ESTE ARQUIVO NÃO É `server-only`. Ele é importado por schemas Zod que
 * rodam nos DOIS lados (a mesma validação no formulário e na Server Action) e
 * por componentes `"use client"`. Um `import "server-only"` aqui quebraria o
 * formulário na compilação.
 *
 * ⚠️ E NÃO MORA EM `src/modules/<domínio>/`. Ele nasceu dentro de Eventos, e lá
 * estava errado assim que Palestras precisou da mesma regra: `lecture.schema`
 * importando de `event.schema` amarraria dois domínios que não têm nada a ver
 * um com o outro pelo motivo mais frágil possível — o de que um deles chegou
 * primeiro.
 */

/**
 * ⚠️ SÃO DOIS NÚMEROS PARA A MESMA REGRA porque quem os consome fala línguas
 * diferentes: o atributo `step` do `<input type="time">` mede em SEGUNDOS, e o
 * resto do mundo pensa em minutos. Derivar um do outro é o que impede alguém
 * mudar a política para 10 minutos no formulário e esquecer da validação — e o
 * sintoma seria um seletor que oferece 08:10 e uma action que recusa.
 */
export const TIME_STEP_MINUTES = 5;
export const TIME_STEP_SECONDS = TIME_STEP_MINUTES * 60;

/** A frase, num lugar só: ela aparece em três módulos. */
export const TIME_STEP_MESSAGE = `Escolha um horário de ${TIME_STEP_MINUTES} em ${TIME_STEP_MINUTES} minutos (00, 05, 10... 55).`;

/** Dica de campo. Curta porque fica embaixo de uma caixa estreita. */
export const TIME_STEP_HINT = `De ${TIME_STEP_MINUTES} em ${TIME_STEP_MINUTES} minutos.`;

/**
 * `"14:05"` está no passo? Espera `HH:MM` — o que o `<input type="time">` produz.
 *
 * Não valida o formato: quem chama já passou pela regex do próprio schema, e
 * duplicar a checagem daria DUAS mensagens de erro para um horário escrito
 * errado.
 */
export function isOnTimeStep(hhmm: string): boolean {
  return Number(hhmm.slice(3, 5)) % TIME_STEP_MINUTES === 0;
}

/**
 * O mesmo para um INSTANTE ISO, que é o que `<input type="datetime-local">`
 * vira depois de convertido (Enquetes).
 *
 * ⚠️ LÊ OS MINUTOS EM UTC, e isso é seguro por um motivo que vale escrever: um
 * fuso desloca a hora, não o minuto dentro dela — e mesmo os fusos quebrados
 * (Índia em +5:30, Nepal em +5:45) deslocam por múltiplos de 15 minutos, que
 * são múltiplos de 5. A grade sobrevive à conversão. Fatiar a string em vez
 * disso quebraria: `"...T10:05:00-03:00"` e `"...T13:05:00Z"` são o mesmo
 * instante, e só um dos dois tem o minuto onde o `slice` procura.
 */
export function isInstantOnTimeStep(iso: string): boolean {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return true; // formato inválido: erro de outro refine
  return data.getUTCMinutes() % TIME_STEP_MINUTES === 0;
}
