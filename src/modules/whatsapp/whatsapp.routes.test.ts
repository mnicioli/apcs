import { describe, expect, it } from "vitest";
import { isWhatsAppId, parseWhatsAppParams, whatsappHref } from "./whatsapp.routes";
import { formatWhatsAppPhone, whatsappDisplayName } from "./whatsapp.schema";

/**
 * As URLs da caixa e o nome que cada conversa recebe.
 *
 * O que estes testes protegem não é a formatação da string: é o COMPORTAMENTO
 * de um endereço colado errado. Numa tela em que o time manda link para o
 * colega o dia todo, um `?conversa=lixo` tem de mostrar a caixa — não um erro.
 */

const ID = "11111111-1111-4111-8111-111111111111";

describe("parseWhatsAppParams", () => {
  it("sem parâmetros: todas, sem busca, nenhuma conversa aberta", () => {
    expect(parseWhatsAppParams({})).toEqual({ filter: "all", search: "", chatId: null });
  });

  it("lê um filtro válido", () => {
    expect(parseWhatsAppParams({ filtro: "archived" }).filter).toBe("archived");
  });

  it("filtro desconhecido cai em “todas”, e não em lista vazia", () => {
    expect(parseWhatsAppParams({ filtro: "pendentes" }).filter).toBe("all");
  });

  it("apara a busca", () => {
    expect(parseWhatsAppParams({ q: "  silva  " }).search).toBe("silva");
  });

  it("⚠️ id que não é uuid vira “nenhuma conversa”, e não chega ao Postgres", () => {
    // Sem isto, um link velho colado no grupo do time viraria um erro de banco
    // — que aparece para quem clicou como falha do sistema.
    expect(parseWhatsAppParams({ conversa: "abc" }).chatId).toBeNull();
    expect(parseWhatsAppParams({ conversa: ID }).chatId).toBe(ID);
  });

  it("usa o primeiro valor quando o parâmetro vem repetido", () => {
    expect(parseWhatsAppParams({ filtro: ["groups", "all"] }).filter).toBe("groups");
  });
});

describe("isWhatsAppId", () => {
  it("aceita uuid e recusa o resto", () => {
    expect(isWhatsAppId(ID)).toBe(true);
    expect(isWhatsAppId("")).toBe(false);
    expect(isWhatsAppId("11111111-1111-4111-8111")).toBe(false);
    expect(isWhatsAppId("../../etc/passwd")).toBe(false);
  });
});

describe("whatsappHref", () => {
  const atual = { filter: "unread" as const, search: "silva", chatId: ID };

  it("abrir uma conversa preserva o recorte", () => {
    expect(whatsappHref({ ...atual, chatId: null }, { chatId: ID })).toBe(
      `/whatsapp?filtro=unread&q=silva&conversa=${ID}`,
    );
  });

  it("⚠️ trocar de aba FECHA a conversa aberta", () => {
    // A conversa que estava na tela quase nunca está na aba nova; deixá-la
    // aberta mostraria uma transcrição sem linha correspondente ao lado.
    expect(whatsappHref(atual, { filter: "archived" })).toBe("/whatsapp?filtro=archived&q=silva");
  });

  it("trocar a busca também fecha a conversa", () => {
    expect(whatsappHref(atual, { search: "souza" })).toBe("/whatsapp?filtro=unread&q=souza");
  });

  it("omite o que é padrão", () => {
    expect(whatsappHref({ filter: "all", search: "", chatId: null }, {})).toBe("/whatsapp");
  });

  it("escapa o termo de busca", () => {
    expect(whatsappHref({ filter: "all", search: "a&b=c", chatId: null }, {})).toBe(
      "/whatsapp?q=a%26b%3Dc",
    );
  });

  it("fechar a conversa explicitamente não mexe no recorte", () => {
    expect(whatsappHref(atual, { chatId: null })).toBe("/whatsapp?filtro=unread&q=silva");
  });
});

describe("whatsappDisplayName", () => {
  it("o nome vence", () => {
    expect(whatsappDisplayName({ name: "João", phone: "5554991234567", isGroup: false })).toBe(
      "João",
    );
  });

  it("sem nome, o telefone formatado", () => {
    expect(whatsappDisplayName({ name: null, phone: "5554991234567", isGroup: false })).toBe(
      "(54) 99123-4567",
    );
  });

  it("sem nada, diz o que é — nunca uma linha em branco", () => {
    expect(whatsappDisplayName({ name: "  ", phone: null, isGroup: false })).toBe(
      "Contato sem nome",
    );
    expect(whatsappDisplayName({ name: null, phone: null, isGroup: true })).toBe("Grupo sem nome");
  });
});

describe("formatWhatsAppPhone", () => {
  it("celular e fixo brasileiros", () => {
    expect(formatWhatsAppPhone("5554991234567")).toBe("(54) 99123-4567");
    expect(formatWhatsAppPhone("551436228140")).toBe("(14) 3622-8140");
  });

  it("aceita o número sem o código do país", () => {
    expect(formatWhatsAppPhone("54991234567")).toBe("(54) 99123-4567");
  });

  it("o que não casa com o formato brasileiro sai como veio", () => {
    expect(formatWhatsAppPhone("351912345678")).toBe("351912345678");
    expect(formatWhatsAppPhone("")).toBe("");
  });

  it("⚠️ um estrangeiro de 11 dígitos é indistinguível de um celular daqui", () => {
    // Limitação conhecida e aceita. Só afeta a EXIBIÇÃO — o envio usa
    // `chat_key`, que é o E.164 cru do fornecedor. Distinguir de verdade
    // exigiria uma tabela de códigos de país inteira para melhorar a leitura de
    // um caso que a APCS praticamente não tem.
    expect(formatWhatsAppPhone("14155552671")).toBe("(14) 15555-2671");
  });
});
