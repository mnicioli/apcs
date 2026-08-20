import { CloudApiProvider, readCloudApiConfig } from "./providers/cloud-api";
import { FakeProvider } from "./providers/fake";
import { UnconfiguredProvider } from "./providers/unconfigured";
import { ZApiProvider, readZApiConfig } from "./providers/z-api";
import type { MessagingProvider } from "./messaging.types";

/**
 * §3. Onde se escolhe o fornecedor — o ÚNICO lugar que sabe que ele existe.
 *
 * Trocar de fornecedor é acrescentar um `case` aqui e um arquivo em
 * `providers/`. Nem o worker, nem o webhook, nem as telas mudam. A Z-API foi
 * exatamente isso: um arquivo novo e as linhas abaixo.
 */

export type ProviderKey = "whatsapp_cloud_api" | "z_api" | "fake" | "none";

export function readProviderKey(env: NodeJS.ProcessEnv = process.env): ProviderKey {
  const bruto = env.APCS_WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (bruto === "fake") return "fake";
  if (bruto === "none") return "none";
  if (bruto === "z_api" || bruto === "zapi") return "z_api";
  if (bruto === "whatsapp_cloud_api" || bruto === "cloud_api") return "whatsapp_cloud_api";

  // ⚠️ SEM ESCOLHA EXPLÍCITA: VALE O QUE ESTIVER CONFIGURADO.
  //
  // Antes daqui havia um só adaptador e o padrão podia ser fixo. Com dois, um
  // padrão fixo produz o pior erro de configuração que existe: quem preencheu
  // as quatro variáveis da Z-API e esqueceu de escolher recebe a mensagem
  // "falta APCS_WHATSAPP_TOKEN" — apontando para as variáveis da META, de uma
  // integração que essa pessoa nem contratou. Meia hora procurando um token que
  // não devia existir.
  //
  // A regra é determinística, e não adivinhação: só decide quando UM dos dois
  // está inteiro e o outro não. Com os dois configurados (ou nenhum), a escolha
  // é ambígua de verdade e o padrão histórico prevalece — quem tem os dois
  // precisa dizer qual quer.
  const zapi = readZApiConfig(env).config !== null;
  const meta = readCloudApiConfig(env).config !== null;
  if (zapi && !meta) return "z_api";

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

  if (chave === "z_api") {
    const { config, missing } = readZApiConfig(env);
    if (!config) return new UnconfiguredProvider(missing);
    return new ZApiProvider(env);
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
