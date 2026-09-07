/**
 * Telefone: o que se guarda e o que se mostra.
 *
 * ⚠️ NASCEU DE UMA DUPLICAÇÃO QUE JÁ EXISTIA. `onlyDigits` estava escrito duas
 * vezes — em `membership.schema.ts` (`/\D+/g`) e em `event.landing.schema.ts`
 * (`/\D/g`) — com o mesmo resultado e nenhuma ligação entre as duas. Duas
 * cópias da mesma regra é como elas passam a discordar: bastaria alguém
 * resolver aceitar o "+" numa delas.
 *
 * Os dois módulos passaram a reexportar daqui, então quem já importava de lá
 * continua importando de lá — o mesmo arranjo de `formatTime`, que saiu de
 * Eventos para `utils.ts` quando Palestras precisou dele.
 *
 * ⚠️ SEM `server-only` E SEM `"use client"`: os formulários do CRM, o formulário
 * público de associação e o de inscrição em eventos usam as três funções, e os
 * dois últimos rodam no navegador.
 */

/** Só os dígitos. É a forma que o banco guarda — máscara é assunto de tela. */
export const onlyDigits = (value: string | null | undefined): string =>
  (value ?? "").replace(/\D+/g, "");

/**
 * Quantos dígitos um telefone pode ter, no menor e no maior caso.
 *
 * ============================================================================
 * ⚠️ O TETO É O DO E.164, E ELE PRECISA SER O MESMO NÚMERO EM DOIS LUGARES.
 * ============================================================================
 * Quinze é o comprimento máximo que a norma internacional de numeração admite —
 * não há telefone maior no mundo. Dez é o menor número brasileiro (DDD + 8).
 *
 * As constantes existem porque esses dois números aparecem em DOIS papéis
 * diferentes, e eles têm de concordar:
 *
 *   * a MÁSCARA, que decide até onde deixa digitar (`formatPhoneInput`);
 *   * a VALIDAÇÃO, que decide o que o servidor aceita (`phoneSchema`, em
 *     `event.landing.schema.ts`).
 *
 * Enquanto o teto vivia só na validação, o campo aceitava quarenta dígitos e o
 * formulário só reclamava no envio — depois de a pessoa preencher tudo. E se
 * alguém frouxasse um dos dois lados sem mexer no outro, a diferença
 * apareceria como um campo que deixa digitar o que o servidor recusa.
 */
export const MIN_PHONE_DIGITS = 10;
export const MAX_PHONE_DIGITS = 15;

/**
 * A máscara brasileira: `(11) 99999-9999`.
 *
 * Corta em 11 dígitos porque é o maior número nacional que existe (DDD + 9).
 * Para o que passa disso, ver `formatPhoneInput`.
 */
export function formatWhatsapp(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * A máscara para um campo que a pessoa está DIGITANDO — e que pode receber um
 * número de fora do Brasil.
 *
 * ============================================================================
 * ⚠️ POR QUE NÃO É SÓ `formatWhatsapp`.
 * ============================================================================
 * O §17 do Prompt 3 diz duas coisas ao mesmo tempo: "utilizar os formatadores
 * existentes" e "se o projeto estiver preparado para números internacionais,
 * preservar essa capacidade". `formatWhatsapp` sozinha não atende a segunda —
 * ela CORTA em 11 dígitos, e o schema de participantes aceita de 10 a 15
 * (`phoneSchema`, o teto do E.164). Um número português de 12 dígitos digitado
 * num campo mascarado por ela perderia o último algarismo em silêncio, e o
 * formulário recusaria um telefone que a pessoa digitou certo.
 *
 * A saída não é uma segunda máscara: é usar a existente onde ela vale — até 11
 * dígitos, que cobre todo número brasileiro — e sair da frente acima disso.
 *
 * ============================================================================
 * ⚠️ E ELA PARA EM 15 DÍGITOS. "SAIR DA FRENTE" NÃO ERA PARA SER "SEM LIMITE".
 * ============================================================================
 * Acima de 11 dígitos esta função devolvia o que recebesse — e o campo aceitava
 * quarenta algarismos sem uma palavra. O erro só aparecia no ENVIO, vindo do
 * `phoneSchema`, depois de a pessoa ter preenchido a inscrição inteira. Cortar
 * na digitação é a mesma escolha do campo de capacidade do Builder: deixar
 * digitar para recusar depois é pior do que não deixar digitar.
 *
 * ⚠️ O CORTE É EM DÍGITOS, E NÃO UM `maxLength` NO `<input>`. Parece a solução
 * óbvia e é a errada, por uma razão que só aparece na conta: `maxLength` conta
 * CARACTERES, e a máscara brasileira completa — `(11) 99999-9999` — tem
 * exatamente 15. Com `maxLength={15}` o navegador bloquearia a digitação do
 * 12º dígito, que é justamente onde um número estrangeiro começa a existir. A
 * capacidade internacional que o §17 mandou preservar morreria por causa de
 * dois parênteses e um hífen.
 */
export function formatPhoneInput(value: string): string {
  const digitos = onlyDigits(value).slice(0, MAX_PHONE_DIGITS);
  // Acima de 11 dígitos não há número nacional possível: quem digitou isso está
  // informando um número estrangeiro, e a máscara do DDD só atrapalharia.
  if (digitos.length > 11) return digitos;
  return formatWhatsapp(digitos);
}
