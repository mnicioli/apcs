/**
 * §24, §61. O TERMO QUE VEIO DE FORA, PREPARADO PARA UMA BUSCA POR NOME.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ ESTE ARQUIVO NASCEU DE UM FURO REAL
 * ----------------------------------------------------------------------------
 * As portas de chatbot procuram documento e boletim pelo NOME, com `ilike`:
 *
 *     .ilike("name", subject.trim())
 *
 * E `subject` é o termo que o MODELO extraiu da mensagem — ou seja, texto
 * escrito por quem está do outro lado do WhatsApp, copiado literalmente (o
 * prompt manda copiar como a pessoa escreveu).
 *
 * No `ILIKE` do Postgres, `%` e `_` são CURINGAS. Uma pessoa que escrevesse
 *
 *     "me manda a normativa %"
 *
 * faria o `subject` virar `%` — que casa com QUALQUER nome. Com uma única
 * normativa publicada, ela seria entregue como se tivesse sido pedida pelo
 * nome; com várias, o `maybeSingle()` estouraria e a ferramenta devolveria erro
 * em vez de cair no catálogo e perguntar qual.
 *
 * Não é injeção de SQL — o PostgREST parametriza, e o §61 continua satisfeito
 * por construção. É pior de perceber: uma consulta legítima, com um filtro que
 * a pessoa de fora escolheu.
 *
 * ⚠️ E POR QUE ESCAPAR EM VEZ DE REMOVER. Existe documento com `%` no nome
 * ("Redução de 50% na taxa"). Remover o caractere impediria de achá-lo pelo
 * nome certo; escapar faz o `%` valer como o próprio `%`, que é o que a pessoa
 * quis dizer nos dois casos — no legítimo e no malicioso.
 *
 * É o mesmo problema que `termoDeBusca` já resolvia na caixa de entrada do
 * WhatsApp, e a solução aqui é diferente pela razão acima: lá é uma BUSCA
 * (curinga não faz sentido), aqui é uma comparação de nome exato.
 */

/**
 * Escapa os curingas do `LIKE`/`ILIKE` para que valham como caracteres comuns.
 *
 * A barra invertida vem primeiro — escapá-la depois dos outros dobraria as
 * barras que nós mesmos acabamos de inserir.
 */
export function escapeLikePattern(termo: string): string {
  return termo.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Teto do termo que vai para uma consulta por nome.
 *
 * Nenhum documento da APCS tem nome de 200 caracteres. Um `subject` desse
 * tamanho é a mensagem inteira tendo escapado do classificador — e mandá-lo ao
 * banco é gastar uma consulta para não achar nada.
 */
const MAX_LOOKUP_CHARS = 120;

/**
 * O termo pronto para a busca por nome, ou `null` quando não há termo útil.
 *
 * `null` NÃO é "não achei": é "não vale procurar". Quem chama trata os dois
 * igual (cai no catálogo e pergunta qual), e é o comportamento certo para os
 * dois.
 */
export function prepareNameLookup(subject: string | null | undefined): string | null {
  const limpo = (subject ?? "").trim();
  if (limpo.length === 0 || limpo.length > MAX_LOOKUP_CHARS) return null;

  const escapado = escapeLikePattern(limpo);

  // ⚠️ SÓ CURINGA NÃO É NOME. Um termo que, depois de escapado, não sobrou
  // nada além de pontuação não identifica documento nenhum — e deixá-lo passar
  // gastaria uma consulta para devolver o primeiro que aparecesse.
  return /[\p{L}\p{N}]/u.test(limpo) ? escapado : null;
}
