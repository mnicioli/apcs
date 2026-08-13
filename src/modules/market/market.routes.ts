/**
 * Endereços das telas da Bolsa.
 *
 * ROTA PRÓPRIA, e não `/documents/<categoria>`: a Bolsa não é uma categoria de
 * `documents` (ver o cabeçalho da migration), então a rota de categorias, que
 * resolve o slug contra o enum do banco, devolveria "não encontrado". No MENU
 * ela aparece sob Documentos — o agrupamento é de navegação, não de dados.
 *
 * O SLUG É PARTE DO CONTRATO PÚBLICO: uma vez em uso, mudá-lo quebra endereço
 * de quem guardou. Por isso é uma constante, e não uma transformação do nome.
 */
export const MARKET_BASE_PATH = "/market";

/** URL da lista, ou do histórico de uma Bolsa. */
export function marketHref(bulletinId?: string): string {
  return bulletinId ? `${MARKET_BASE_PATH}/${bulletinId}` : MARKET_BASE_PATH;
}

/**
 * Caminhos para invalidar o cache depois de escrever.
 *
 * São os PADRÕES de rota, não endereços concretos: invalidar a lista e o
 * detalhe cobre toda tela que mostra o estado de uma publicação, e uma tela de
 * backoffice não paga nada por isso.
 */
export const MARKET_ROUTE_PATTERNS = [MARKET_BASE_PATH, `${MARKET_BASE_PATH}/[id]`];
