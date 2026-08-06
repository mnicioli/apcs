/**
 * Sem `server-only` de propósito: a função é pura, recebe o valor por parâmetro
 * e não lê `process.env` nem toca em segredo. Quem lê o ambiente é o chamador
 * (`engine.ts`, `llm.ts`), e é lá que a barreira de servidor está declarada.
 * Manter a marcação aqui só impediria o teste de rodar.
 */

/**
 * Lê uma variável de ambiente tratando VAZIA como AUSENTE.
 *
 * `process.env.X ?? padrao` não serve para configuração vinda de arquivo: quem
 * copia o `.env.example` e não preenche fica com `X=`, que é string vazia e não
 * `undefined`. O `??` não dispara, o valor vazio segue adiante e o defeito só
 * aparece em produção — num texto de consentimento sem link, num modelo de LLM
 * inexistente, num registro de LGPD com versão em branco.
 */
export function envOrFallback(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
