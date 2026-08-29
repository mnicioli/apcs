import { describe, expect, it } from "vitest";
import { isOptOutRequest } from "./survey.inbound";
import { notificationPhoneKey } from "@/lib/services/membership";

/**
 * O "NÃO ME MANDE MAIS".
 *
 * ⚠️ ESTES TESTES NASCERAM DE UM BUG EM PRODUÇÃO: um associado recebeu a
 * divulgação de um evento, respondeu SAIR, e continuou recebendo. O
 * reconhecimento da palavra estava certo — o problema era que ele só rodava
 * dentro de uma conversa de enquete. Os testes abaixo fixam as duas metades
 * que precisavam existir para o conserto funcionar.
 */

describe("isOptOutRequest", () => {
  it("reconhece SAIR em qualquer caixa", () => {
    for (const texto of ["SAIR", "sair", "Sair", "SaIr"]) {
      expect(isOptOutRequest(texto), texto).toBe(true);
    }
  });

  it("reconhece as outras formas de pedir para parar", () => {
    for (const texto of ["parar", "PARE", "stop", "cancelar", "descadastrar", "remover"]) {
      expect(isOptOutRequest(texto), texto).toBe(true);
    }
  });

  /**
   * Quem está irritado escreve com pontuação e acento. A normalização já tira
   * os dois — este teste existe para que ninguém a remova achando que é enfeite.
   */
  it("ignora pontuação, acento e espaço sobrando", () => {
    for (const texto of ["SAIR!", "  sair  ", "não quero receber", "nao quero receber"]) {
      expect(isOptOutRequest(texto), texto).toBe(true);
    }
  });

  it("não confunde uma frase que contém a palavra com o pedido", () => {
    // ⚠️ A comparação é da mensagem INTEIRA, não `includes`. "vou sair da
    // granja mais tarde" não é um pedido para parar de receber, e bloquear
    // alguém por engano é tão ruim quanto não bloquear quem pediu.
    expect(isOptOutRequest("vou sair da granja mais tarde")).toBe(false);
    expect(isOptOutRequest("posso cancelar minha inscrição no evento?")).toBe(false);
  });

  it("não reage a resposta de enquete nem a mensagem vazia", () => {
    expect(isOptOutRequest("1")).toBe(false);
    expect(isOptOutRequest("")).toBe(false);
    expect(isOptOutRequest("   ")).toBe(false);
  });
});

/**
 * ⚠️ ESTE BLOCO VIGIA UMA DUPLICAÇÃO CONSCIENTE.
 *
 * A chave de telefone existe em dois lugares: `notification_phone_key()` no
 * Postgres e `notificationPhoneKey()` no TypeScript. A do banco decide QUEM É
 * BLOQUEADO no disparo; a do TypeScript decide o que a lista de associados
 * MOSTRA. Se divergirem, a tela diz "Recebe" para quem pediu para sair — uma
 * mentira silenciosa, na única tela onde alguém iria conferir.
 *
 * A regra, nas duas: os últimos 11 dígitos (DDD + celular), só dígitos.
 */
describe("notificationPhoneKey", () => {
  it("iguala o telefone com e sem DDI — a causa raiz do bug", () => {
    // `members.whatsapp` guarda sem DDI; `chat_contacts.phone`, com.
    expect(notificationPhoneKey("19992773100")).toBe("19992773100");
    expect(notificationPhoneKey("5519992773100")).toBe("19992773100");
    expect(notificationPhoneKey("19992773100")).toBe(notificationPhoneKey("5519992773100"));
  });

  it("ignora a formatação que a tela aplica", () => {
    expect(notificationPhoneKey("(19) 99277-3100")).toBe("19992773100");
    expect(notificationPhoneKey("+55 19 99277-3100")).toBe("19992773100");
  });

  it("não inventa chave para entrada vazia", () => {
    expect(notificationPhoneKey(null)).toBe("");
    expect(notificationPhoneKey(undefined)).toBe("");
    expect(notificationPhoneKey("")).toBe("");
  });

  /**
   * ⚠️ 11 dígitos, e não 8 ou 9. Com menos, dois números de DDDs diferentes
   * colidiriam — e bloquear a pessoa errada é tão ruim quanto não bloquear a
   * certa.
   */
  it("distingue números iguais de DDDs diferentes", () => {
    expect(notificationPhoneKey("11992773100")).not.toBe(notificationPhoneKey("19992773100"));
  });
});
