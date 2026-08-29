import { describe, expect, it } from "vitest";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { SETTING_KEYS, SETTING_LABELS } from "./admin.labels";
import {
  inviteUserSchema,
  publishConsentSchema,
  resumeBlockSchema,
  setSettingSchema,
  updateSegmentSchema,
} from "./admin.schema";

/**
 * Os contratos de entrada da Administração.
 *
 * ⚠️ O que estes testes NÃO provam: as travas de verdade. "Não deixar o sistema
 * sem administrador" e "ninguém troca o próprio cargo" vivem em
 * `set_user_role_key()`, no Postgres, porque dependem de contar linhas e de
 * saber quem está chamando — coisas que um schema não sabe. Aqui se prova o
 * formato; a bateria SQL prova o resto.
 */

const ID = "11111111-1111-4111-8111-111111111111";

describe("inviteUserSchema", () => {
  it("aceita um convite completo", () => {
    const r = inviteUserSchema.safeParse({
      email: "Maria@APCS.org.br",
      fullName: "Maria da Silva",
      role: "comercial",
    });
    expect(r.success).toBe(true);
    // ⚠️ O e-mail é normalizado para minúsculas: o Supabase trata e-mail de
    // forma insensível a caixa, e guardar "Maria@" faria a lista mostrar duas
    // grafias da mesma pessoa se alguém a convidasse de novo.
    if (r.success) expect(r.data.email).toBe("maria@apcs.org.br");
  });

  it("exige e-mail válido", () => {
    expect(inviteUserSchema.safeParse({ email: "sem-arroba", role: "viewer" }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ email: "", role: "viewer" }).success).toBe(false);
  });

  it("aceita convite sem nome", () => {
    const r = inviteUserSchema.safeParse({ email: "novo@apcs.org.br", role: "viewer" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.fullName).toBeUndefined();
  });

  /**
   * ⚠️ O PAPEL É OBRIGATÓRIO NO CONVITE, e este teste é o que impede alguém
   * torná-lo opcional "para simplificar". Sem ele, toda pessoa convidada entraria
   * como `viewer` (é o trigger `handle_new_user`) e ficaria esperando um segundo
   * clique que ninguém lembra de dar.
   */
  it("exige o papel", () => {
    expect(inviteUserSchema.safeParse({ email: "novo@apcs.org.br" }).success).toBe(false);
  });
});

describe("updateSegmentSchema", () => {
  it("aceita a edição de um público", () => {
    const r = updateSegmentSchema.safeParse({
      segmentId: ID,
      name: "Criadores",
      description: "Atuam diretamente na produção.",
      active: true,
    });
    expect(r.success).toBe(true);
  });

  /**
   * ⚠️ O SLUG NÃO ESTÁ NO SCHEMA, e não pode entrar. Ele prende os eventos já
   * cadastrados e o mapeamento perfil ↔ público; trocá-lo pela tela quebraria os
   * dois sem erro nenhum aparecer. Um slug enviado é ignorado, não aceito.
   */
  it("ignora o slug se alguém mandar", () => {
    const r = updateSegmentSchema.safeParse({
      segmentId: ID,
      name: "Criadores",
      active: true,
      slug: "outra-coisa",
    });
    expect(r.success).toBe(true);
    if (r.success) expect("slug" in r.data).toBe(false);
  });

  it("exige um nome com pelo menos duas letras", () => {
    expect(updateSegmentSchema.safeParse({ segmentId: ID, name: "C", active: true }).success).toBe(
      false,
    );
  });
});

describe("setSettingSchema", () => {
  /**
   * ⚠️ A CHAVE É UM ENUM FECHADO. Um campo livre deixaria alguém gravar
   * `whatsapp.optout_confirmed` (sem o underscore certo) e passar semanas
   * achando que editou a mensagem que sai — enquanto o código lê a outra chave.
   */
  it("só aceita as chaves que a tela conhece", () => {
    expect(
      setSettingSchema.safeParse({ key: SETTING_KEYS.optOutConfirmed, value: "Pronto." }).success,
    ).toBe(true);
    expect(setSettingSchema.safeParse({ key: "whatsapp.qualquer", value: "x" }).success).toBe(
      false,
    );
  });

  it("recusa texto vazio", () => {
    // Uma confirmação de opt-out em branco seria a pessoa que acabou de pedir
    // para parar recebendo uma mensagem vazia.
    expect(
      setSettingSchema.safeParse({ key: SETTING_KEYS.optOutConfirmed, value: "   " }).success,
    ).toBe(false);
  });

  it("toda chave conhecida tem rótulo e explicação", () => {
    for (const chave of Object.values(SETTING_KEYS)) {
      expect(SETTING_LABELS[chave]?.title.length).toBeGreaterThan(0);
      expect(SETTING_LABELS[chave]?.help.length).toBeGreaterThan(0);
    }
  });
});

describe("publishConsentSchema", () => {
  const texto = "Autorizo a APCS a tratar meus dados conforme a LGPD.";

  it("aceita uma versão nova", () => {
    expect(publishConsentSchema.safeParse({ version: "2026-09-v1", body: texto }).success).toBe(
      true,
    );
  });

  it("recusa versão com caractere que o banco não aceita", () => {
    // O CHECK `consent_texts_version_format` só admite letras, números, ponto,
    // hífen e sublinhado. Recusar aqui dá a mensagem certa em vez de um erro
    // genérico depois de submeter.
    expect(publishConsentSchema.safeParse({ version: "2026/09", body: texto }).success).toBe(false);
    expect(publishConsentSchema.safeParse({ version: "v 1", body: texto }).success).toBe(false);
  });

  it("recusa um texto curto demais para dizer alguma coisa", () => {
    expect(publishConsentSchema.safeParse({ version: "2026-09-v1", body: "ok" }).success).toBe(
      false,
    );
  });
});

describe("resumeBlockSchema", () => {
  it("exige registrar quem pediu", () => {
    expect(resumeBlockSchema.safeParse({ blockId: ID, note: "" }).success).toBe(false);
    expect(resumeBlockSchema.safeParse({ blockId: ID, note: "ok" }).success).toBe(false);
    expect(resumeBlockSchema.safeParse({ blockId: ID, note: "pediu por telefone" }).success).toBe(
      true,
    );
  });
});

describe("as mensagens de erro da Administração", () => {
  it("dizem o que fazer, e não só o que deu errado", () => {
    // O convite que não sai se resolve NO PAINEL DO SUPABASE, não aqui: a
    // mensagem tem de mandar a pessoa para o lugar certo.
    expect(ACTION_ERROR_MESSAGES.inviteFailed).toMatch(/Supabase/);
    expect(ACTION_ERROR_MESSAGES.lastAdmin).toMatch(/Promova/);
    expect(ACTION_ERROR_MESSAGES.cannotChangeOwnRole).toMatch(/outro administrador/i);
    expect(ACTION_ERROR_MESSAGES.consentVersionExists).toMatch(/versão nova/i);
  });
});
