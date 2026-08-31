import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSiteOrigin } from "./site-url";

let cabecalhos = new Headers();
vi.mock("next/headers", () => ({ headers: async () => cabecalhos }));

const ORIGINAIS = {
  site: process.env.NEXT_PUBLIC_SITE_URL,
  env: process.env.VERCEL_ENV,
  producao: process.env.VERCEL_PROJECT_PRODUCTION_URL,
};

beforeEach(() => {
  cabecalhos = new Headers();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
});

afterEach(() => {
  for (const [chave, valor] of [
    ["NEXT_PUBLIC_SITE_URL", ORIGINAIS.site],
    ["VERCEL_ENV", ORIGINAIS.env],
    ["VERCEL_PROJECT_PRODUCTION_URL", ORIGINAIS.producao],
  ] as const) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
});

describe("getSiteOrigin", () => {
  it("prefere a variável configurada ao cabeçalho da requisição", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://apcs.org.br";
    cabecalhos.set("host", "site-do-atacante.com");

    expect(await getSiteOrigin()).toBe("https://apcs.org.br");
  });

  it("tira a barra do fim para o link não sair com barra dupla", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://apcs.org.br/";

    expect(await getSiteOrigin()).toBe("https://apcs.org.br");
  });

  it("completa o protocolo quando a variável vem só com o domínio", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "apcs.vercel.app";

    expect(await getSiteOrigin()).toBe("https://apcs.vercel.app");
  });

  it("respeita http quando o protocolo veio escrito (uso local)", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";

    expect(await getSiteOrigin()).toBe("http://localhost:3000");
  });

  it("usa o domínio de produção da Vercel quando a variável não foi preenchida", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "apcs.vercel.app";
    cabecalhos.set("host", "localhost:3000");

    expect(await getSiteOrigin()).toBe("https://apcs.vercel.app");
  });

  it("em prévia NÃO usa o domínio de produção — cai no cabeçalho da prévia", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "apcs.vercel.app";
    cabecalhos.set("host", "apcs-git-teste.vercel.app");
    cabecalhos.set("x-forwarded-proto", "https");

    expect(await getSiteOrigin()).toBe("https://apcs-git-teste.vercel.app");
  });

  it("assume http em localhost, onde o proxy não manda o protocolo", async () => {
    cabecalhos.set("host", "localhost:3000");

    expect(await getSiteOrigin()).toBe("http://localhost:3000");
  });

  it("prefere x-forwarded-host ao host quando há proxy", async () => {
    cabecalhos.set("host", "interno.vercel.internal");
    cabecalhos.set("x-forwarded-host", "apcs.org.br");
    cabecalhos.set("x-forwarded-proto", "https");

    expect(await getSiteOrigin()).toBe("https://apcs.org.br");
  });

  it("devolve vazio quando não há nenhuma pista de endereço", async () => {
    expect(await getSiteOrigin()).toBe("");
  });
});
