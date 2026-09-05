/**
 * A PONTE ENTRE O INSTANTE ABSOLUTO E O CAMPO DE DATA/HORA — e é onde um fuso
 * vira um defeito.
 *
 * ⚠️ MORAVA DENTRO DE `survey-form.tsx`, e saiu de lá quando o segundo
 * formulário precisou da mesma conversão (o Builder da Landing Page, para o
 * prazo de inscrição). Duas cópias desta função é exatamente como uma tela
 * passa a mostrar 23h e a outra 02h do dia seguinte para o mesmo instante.
 *
 * O banco guarda `timestamptz` (um instante absoluto). O
 * `<input type="datetime-local">` — e o `DateTimeSelect` que o substitui aqui —
 * falam em HORA LOCAL, sem fuso. As duas funções abaixo são a travessia.
 *
 * ⚠️ AS DUAS RODAM NO NAVEGADOR, e é isso que as torna corretas. `new Date(...)`
 * de uma string sem fuso é interpretada na hora LOCAL de quem está lendo — que
 * é justamente o que a pessoa digitou. Chamá-las no servidor (UTC, na Vercel)
 * leria o mesmo texto como se fosse UTC e deslocaria três horas.
 */

/**
 * Instante absoluto → o texto do campo, na hora local.
 *
 * `.slice(0, 16)` no ISO — que é a tentação — mostraria a hora em UTC: uma
 * inscrição que encerra às 23h de São Paulo apareceria como 02h do dia
 * seguinte.
 *
 * `toLocaleString` com `sv-SE` dá o formato ISO curto já no fuso do navegador,
 * que é exatamente o que o campo espera.
 */
export function toLocalInput(instant: string | null | undefined): string {
  if (!instant) return "";
  const data = new Date(instant);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("sv-SE", { hour12: false }).slice(0, 16).replace(" ", "T");
}

/** E a volta: o que a pessoa digitou (hora local) vira instante absoluto. */
export function fromLocalInput(local: string | undefined): string {
  if (!local) return "";
  const data = new Date(local);
  return Number.isNaN(data.getTime()) ? "" : data.toISOString();
}
