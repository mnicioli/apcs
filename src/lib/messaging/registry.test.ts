import { describe, expect, it } from "vitest";
import { createMessagingProvider, readProviderKey } from "./registry";
import { authorizeJob } from "./job-auth";

/**
 * §3, §60, §95. A ESCOLHA DO FORNECEDOR — e as duas recusas que ela precisa
 * saber fazer.
 */

const CONFIGURADO = {
  APCS_WHATSAPP_TOKEN: "token",
  APCS_WHATSAPP_PHONE_NUMBER_ID: "123",
  APCS_WHATSAPP_APP_SECRET: "segredo",
  APCS_WHATSAPP_VERIFY_TOKEN: "verifica",
} as unknown as NodeJS.ProcessEnv;

const ZAPI_CONFIGURADO = {
  APCS_ZAPI_INSTANCE_ID: "inst",
  APCS_ZAPI_TOKEN: "token",
  APCS_ZAPI_CLIENT_TOKEN: "client",
  APCS_ZAPI_WEBHOOK_SECRET: "segredo-do-webhook",
} as unknown as NodeJS.ProcessEnv;

function env(...partes: NodeJS.ProcessEnv[]): NodeJS.ProcessEnv {
  return Object.assign({}, ...partes) as NodeJS.ProcessEnv;
}

describe("readProviderKey", () => {
  it("o padrão é a Cloud API", () => {
    expect(readProviderKey({} as unknown as NodeJS.ProcessEnv)).toBe("whatsapp_cloud_api");
  });

  it("aceita os apelidos", () => {
    expect(
      readProviderKey({ APCS_WHATSAPP_PROVIDER: "cloud_api" } as unknown as NodeJS.ProcessEnv),
    ).toBe("whatsapp_cloud_api");
    expect(
      readProviderKey({ APCS_WHATSAPP_PROVIDER: " FAKE " } as unknown as NodeJS.ProcessEnv),
    ).toBe("fake");
    expect(
      readProviderKey({ APCS_WHATSAPP_PROVIDER: "none" } as unknown as NodeJS.ProcessEnv),
    ).toBe("none");
    expect(
      readProviderKey({ APCS_WHATSAPP_PROVIDER: "z_api" } as unknown as NodeJS.ProcessEnv),
    ).toBe("z_api");
    expect(
      readProviderKey({ APCS_WHATSAPP_PROVIDER: " ZAPI " } as unknown as NodeJS.ProcessEnv),
    ).toBe("z_api");
  });

  it("valor desconhecido cai no padrão, que se declara não configurado", () => {
    expect(
      readProviderKey({ APCS_WHATSAPP_PROVIDER: "twilio" } as unknown as NodeJS.ProcessEnv),
    ).toBe("whatsapp_cloud_api");
  });

  /**
   * ⚠️ O ERRO DE CONFIGURAÇÃO QUE ESTES TRÊS CASOS EVITAM.
   *
   * Com dois adaptadores e um padrão FIXO, quem preenche as quatro variáveis da
   * Z-API e esquece de escolher recebe "falta APCS_WHATSAPP_TOKEN" — apontando
   * para as variáveis da META, de uma integração que essa pessoa nem contratou.
   * A regra só decide quando UM dos dois está inteiro; com os dois (ou nenhum),
   * a ambiguidade é real e o padrão histórico prevalece.
   */
  describe("sem escolha explícita, vale o que estiver configurado", () => {
    it("só a Z-API configurada → Z-API", () => {
      expect(readProviderKey(ZAPI_CONFIGURADO)).toBe("z_api");
    });

    it("só a Meta configurada → Cloud API", () => {
      expect(readProviderKey(CONFIGURADO)).toBe("whatsapp_cloud_api");
    });

    it("os dois configurados → o padrão histórico, porque a escolha é ambígua", () => {
      expect(readProviderKey(env(CONFIGURADO, ZAPI_CONFIGURADO))).toBe("whatsapp_cloud_api");
    });

    it("a escolha explícita vence a configuração", () => {
      expect(
        readProviderKey(
          env(CONFIGURADO, ZAPI_CONFIGURADO, {
            APCS_WHATSAPP_PROVIDER: "z_api",
          } as unknown as NodeJS.ProcessEnv),
        ),
      ).toBe("z_api");
    });

    it("Z-API pela metade NÃO é escolhida: falta de segredo do webhook não vira caixa aberta", () => {
      const semSegredo = env(ZAPI_CONFIGURADO, {
        APCS_ZAPI_WEBHOOK_SECRET: "",
      } as unknown as NodeJS.ProcessEnv);
      expect(readProviderKey(semSegredo)).toBe("whatsapp_cloud_api");
    });
  });
});

describe("createMessagingProvider com a Z-API", () => {
  it("configurada, devolve o adaptador da Z-API", () => {
    const p = createMessagingProvider(
      env(ZAPI_CONFIGURADO, { APCS_WHATSAPP_PROVIDER: "z_api" } as unknown as NodeJS.ProcessEnv),
    );
    expect(p.name).toBe("z_api");
    expect(p.configured).toBe(true);
  });

  it("⚠️ SEM O SEGREDO DO WEBHOOK, RECUSA — e diz qual variável falta", () => {
    // Poderia funcionar: o ENVIO não usa o segredo. Mas aí o webhook ficaria de
    // pé sem autenticação nenhuma (a Z-API não assina), e qualquer pessoa na
    // internet poderia inserir na caixa uma mensagem que um associado nunca
    // mandou. "Configurei a Z-API" e "o webhook está protegido" têm de ser a
    // mesma frase.
    const p = createMessagingProvider(
      env(ZAPI_CONFIGURADO, {
        APCS_WHATSAPP_PROVIDER: "z_api",
        APCS_ZAPI_WEBHOOK_SECRET: "",
      } as unknown as NodeJS.ProcessEnv),
    );

    expect(p.configured).toBe(false);
    expect(p.missing).toContain("APCS_ZAPI_WEBHOOK_SECRET");
  });
});

describe("createMessagingProvider (§95)", () => {
  it("⚠️ SEM VARIÁVEIS, devolve o provedor que RECUSA — e diz o que falta", async () => {
    const p = createMessagingProvider({} as unknown as NodeJS.ProcessEnv);

    expect(p.configured).toBe(false);
    expect(p.missing).toContain("APCS_WHATSAPP_TOKEN");
    expect(p.missing).toContain("APCS_WHATSAPP_APP_SECRET");

    // O ponto do §95 e do §88: ele NÃO finge ter enviado. Um "provedor de log"
    // que respondesse sucesso mostraria "10 enviadas, 0 erros" numa campanha em
    // que ninguém recebeu nada.
    const r = await p.send({ to: "5519991234567", body: "oi", correlationId: "c" });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ retryable: false, code: "not_configured" });
    expect(!r.ok && r.message).toMatch(/não está integrado/i);
  });

  it("variável faltando pela metade também recusa", () => {
    const p = createMessagingProvider({ APCS_WHATSAPP_TOKEN: "t" } as unknown as NodeJS.ProcessEnv);
    expect(p.configured).toBe(false);
    expect(p.missing).toContain("APCS_WHATSAPP_PHONE_NUMBER_ID");
  });

  it("variável VAZIA conta como ausente", () => {
    // Quem copia o `.env.example` e não preenche fica com `X=`, que é string
    // vazia e não `undefined`.
    const p = createMessagingProvider({ ...CONFIGURADO, APCS_WHATSAPP_TOKEN: "" });
    expect(p.configured).toBe(false);
  });

  it("com tudo configurado, é a Cloud API", () => {
    const p = createMessagingProvider(CONFIGURADO);
    expect(p.name).toBe("whatsapp_cloud_api");
    expect(p.configured).toBe(true);
  });

  it("'none' desliga explicitamente", () => {
    const p = createMessagingProvider({
      ...CONFIGURADO,
      APCS_WHATSAPP_PROVIDER: "none",
    });
    expect(p.configured).toBe(false);
  });

  it("o provedor falso existe fora de produção (§60)", () => {
    const p = createMessagingProvider({
      APCS_WHATSAPP_PROVIDER: "fake",
      NODE_ENV: "test",
    } as unknown as NodeJS.ProcessEnv);
    expect(p.name).toBe("fake");
    expect(p.configured).toBe(true);
  });

  it("⚠️ O PROVEDOR FALSO NÃO EXISTE EM PRODUÇÃO", async () => {
    // Uma variável de ambiente é a coisa mais fácil de copiar por engano de um
    // `.env` de homologação para o painel da Vercel. O resultado NÃO pode ser
    // uma campanha que reporta sucesso sem enviar nada — é o pior defeito
    // possível aqui, porque não tem sintoma: os números ficam bonitos.
    const p = createMessagingProvider({
      ...CONFIGURADO,
      APCS_WHATSAPP_PROVIDER: "fake",
      NODE_ENV: "production",
    });

    expect(p.name).not.toBe("fake");
    expect(p.configured).toBe(false);
    const r = await p.send({ to: "5519991234567", body: "oi", correlationId: "c" });
    expect(r.ok).toBe(false);
  });

  it("o provedor não configurado também recusa assinatura de webhook", () => {
    const p = createMessagingProvider({} as unknown as NodeJS.ProcessEnv);
    expect(p.verifySignature("qualquer corpo", new Headers()).valid).toBe(false);
    expect(p.parseWebhook({ object: "whatsapp_business_account" })).toEqual([]);
  });
});

describe("authorizeJob (§18 nas rotas de rotina)", () => {
  it("⚠️ SEM SEGREDO, A ROTA NÃO RODA — e devolve 503, não 401", () => {
    // 503 porque o problema é de configuração do servidor. Um 401 mandaria quem
    // opera procurar o erro no cron, que está certo.
    expect(authorizeJob(new Headers(), {} as unknown as NodeJS.ProcessEnv)).toEqual({
      ok: false,
      status: 503,
      reason: "APCS_JOB_SECRET não configurada",
    });
  });

  it("aceita o Bearer que o Vercel Cron manda", () => {
    const h = new Headers({ authorization: "Bearer abc123" });
    expect(authorizeJob(h, { CRON_SECRET: "abc123" } as unknown as NodeJS.ProcessEnv).ok).toBe(
      true,
    );
  });

  it("aceita o header próprio, para cron externo", () => {
    const h = new Headers({ "x-apcs-job-secret": "abc123" });
    expect(authorizeJob(h, { APCS_JOB_SECRET: "abc123" } as unknown as NodeJS.ProcessEnv).ok).toBe(
      true,
    );
  });

  it("segredo errado ou ausente é 401", () => {
    const env = { APCS_JOB_SECRET: "abc123" } as unknown as NodeJS.ProcessEnv;
    expect(authorizeJob(new Headers(), env)).toMatchObject({ ok: false, status: 401 });
    expect(authorizeJob(new Headers({ authorization: "Bearer errado" }), env)).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(authorizeJob(new Headers({ "x-apcs-job-secret": "abc12" }), env)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("'Bearer' sem token não passa", () => {
    const env = { APCS_JOB_SECRET: "abc123" } as unknown as NodeJS.ProcessEnv;
    expect(authorizeJob(new Headers({ authorization: "Bearer " }), env).ok).toBe(false);
    expect(authorizeJob(new Headers({ authorization: "abc123" }), env).ok).toBe(false);
  });
});
