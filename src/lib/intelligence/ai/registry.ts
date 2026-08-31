import "server-only";
import { AnthropicProvider } from "./anthropic";
import type { AIProvider } from "./ai.types";

/**
 * §79. ONDE SE ESCOLHE O FORNECEDOR DE IA — o único lugar que sabe que ele
 * existe.
 *
 * É o espelho de `src/lib/messaging/registry.ts`, e a simetria é deliberada:
 * quem já leu aquele entende este sem reaprender. Trocar de fornecedor é
 * acrescentar um arquivo em `ai/` e um `case` aqui; nem o motor, nem o
 * roteador, nem o webhook mudam.
 *
 * ⚠️ HOJE HÁ UM SÓ FORNECEDOR, e a abstração vale assim mesmo — não por
 * simetria, mas porque ela é o que impede a próxima chamada de LLM de nascer
 * espalhada. O módulo de mensageria começou igual (só a Cloud API) e a Z-API
 * entrou como um arquivo, sem tocar em nada. É a mesma aposta, com a mesma
 * evidência atrás dela.
 */

export type AIProviderKey = "anthropic";

export function readAIProviderKey(env: NodeJS.ProcessEnv = process.env): AIProviderKey {
  const bruto = env.APCS_AI_PROVIDER?.trim().toLowerCase();

  // ⚠️ VALOR DESCONHECIDO NÃO VIRA "NENHUM FORNECEDOR". Uma variável escrita
  // errado no painel derrubaria o atendimento inteiro em silêncio; cair no
  // padrão e seguir é o comportamento que uma pessoa esperaria de um `.env`
  // com um erro de digitação.
  if (bruto && bruto !== "anthropic") {
    console.warn(
      `[intelligence.ai] APCS_AI_PROVIDER desconhecido; usando "anthropic". Recebido: ${bruto}`,
    );
  }

  return "anthropic";
}

export function createAIProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  readAIProviderKey(env);
  return new AnthropicProvider(env.ANTHROPIC_API_KEY);
}

/**
 * O provedor do processo.
 *
 * Guardado porque o cliente da Anthropic mantém um pool de conexões: criar um
 * a cada mensagem desperdiçaria o handshake TLS em toda classificação.
 */
let cached: AIProvider | null = null;

export function aiProvider(): AIProvider {
  cached ??= createAIProvider();
  return cached;
}

/** Só para teste: injeta um provedor e devolve o de antes. */
export function __setAIProvider(provider: AIProvider | null): AIProvider | null {
  const anterior = cached;
  cached = provider;
  return anterior;
}
