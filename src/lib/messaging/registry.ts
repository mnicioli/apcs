import { CloudApiProvider, readCloudApiConfig } from "./providers/cloud-api";
import { FakeProvider } from "./providers/fake";
import { UnconfiguredProvider } from "./providers/unconfigured";
import type { MessagingProvider } from "./messaging.types";

/**
 * §3. Onde se escolhe o fornecedor — o ÚNICO lugar que sabe que ele existe.
 *
 * Trocar de fornecedor é acrescentar um `case` aqui e um arquivo em
 * `providers/`. Nem o worker, nem o webhook, nem as telas mudam.
 */

export type ProviderKey = "whatsapp_cloud_api" | "fake" | "none";

export function readProviderKey(env: NodeJS.ProcessEnv = process.env): ProviderKey {
  const bruto = env.APCS_WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (bruto === "fake") return "fake";
  if (bruto === "none") return "none";
  if (bruto === "whatsapp_cloud_api" || bruto === "cloud_api") return "whatsapp_cloud_api";
  // Sem escolha explícita: a Cloud API é o padrão, e ela mesma se declara não
  // configurada quando faltam as variáveis. Assim "esqueci de configurar" e
  // "escolhi errado" produzem a mesma mensagem clara em vez de um `undefined`.
  return "whatsapp_cloud_api";
}

/**
 * ⚠️ O FORNECEDOR FALSO NÃO EXISTE EM PRODUÇÃO.
 *
 * Uma variável de ambiente é a coisa mais fácil de copiar por engano de um
 * `.env` de homologação para o painel da Vercel. Se isso acontecer, o resultado
 * NÃO pode ser uma campanha que reporta sucesso sem enviar nada — é o pior
 * defeito possível aqui, porque não tem sintoma: os números ficam bonitos.
 *
 * Em produção o pedido é ignorado e o sistema cai no provedor que recusa alto.
 */
export function createMessagingProvider(env: NodeJS.ProcessEnv = process.env): MessagingProvider {
  const chave = readProviderKey(env);
  const producao = env.NODE_ENV === "production";

  if (chave === "fake") {
    if (producao) {
      return new UnconfiguredProvider([
        "APCS_WHATSAPP_PROVIDER (o provedor 'fake' não é aceito em produção)",
      ]);
    }
    return new FakeProvider(env.APCS_WHATSAPP_APP_SECRET?.trim() || "segredo-de-teste");
  }

  if (chave === "none") {
    return new UnconfiguredProvider(["APCS_WHATSAPP_PROVIDER está como 'none'"]);
  }

  const { config, missing } = readCloudApiConfig(env);
  if (!config) return new UnconfiguredProvider(missing);
  return new CloudApiProvider(env);
}

/**
 * O provedor do processo. Guardado porque o disjuntor (§21) mora na instância:
 * criar um provedor novo a cada mensagem zeraria o contador de falhas e o
 * disjuntor nunca abriria.
 */
let cached: MessagingProvider | null = null;

export function messagingProvider(): MessagingProvider {
  cached ??= createMessagingProvider();
  return cached;
}

/** Só para teste: injeta um provedor e devolve o de antes. */
export function __setMessagingProvider(provider: MessagingProvider | null): void {
  cached = provider;
}
