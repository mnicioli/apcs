import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AS TRÊS LINHAS DE SQL QUE, SE MUDAREM, QUEBRAM TUDO EM SILÊNCIO.
 *
 * ⚠️ A MIGRATION JÁ TEM CONFERÊNCIA — e ela é melhor que este arquivo, porque
 * lê `pg_proc` e `pg_trigger` de verdade. Só que ela roda no `db:push`, ou seja
 * DEPOIS de alguém decidir aplicar em produção. Este teste roda no `pnpm test`,
 * que é antes do commit.
 *
 * As três não têm sintoma. Nenhuma delas dá erro, log, alerta ou tela vermelha:
 * o robô simplesmente passa a fazer a coisa errada, e quem descobre é um
 * associado.
 */

const MIGRATION = join(process.cwd(), "supabase", "migrations", "20260915000000_whatsapp_bot.sql");

const sql = readFileSync(MIGRATION, "utf8");

/**
 * O corpo de uma função `create or replace`, SEM COMENTÁRIOS, até o `$$;`.
 *
 * ⚠️ OS COMENTÁRIOS PRECISAM SAIR, e a razão é quase engraçada: o comentário
 * que explica "esta função não pode mexer em `unread_count`" contém,
 * necessariamente, a palavra `unread_count`. Sem a limpeza, a guarda acusaria a
 * própria explicação dela.
 *
 * É a segunda vez que este projeto tropeça nisso — `chatbot-doors.test.ts` faz
 * a mesma limpeza, pelo mesmo motivo, com `@/lib/supabase/server`. Quem
 * escrever a terceira guarda deste tipo já sabe.
 */
function corpoDaFuncao(nome: string): string {
  const inicio = sql.indexOf(`create or replace function public.${nome}`);
  expect(
    inicio,
    `Não achei a função ${nome} em 20260915000000_whatsapp_bot.sql. Se ela foi ` +
      `renomeada, este teste precisa acompanhar — ele existe justamente para as ` +
      `regras dela não se perderem numa refatoração.`,
  ).toBeGreaterThan(-1);

  const fim = sql.indexOf("\n$$;", inicio);
  return sql.slice(inicio, fim === -1 ? undefined : fim).replace(/--[^\n]*/g, "");
}

describe("o teste está lendo a migration", () => {
  it("o arquivo existe e tem conteúdo", () => {
    // Sem isto, um caminho errado transformaria a bateria inteira num teste que
    // passa sobre nada — o pior tipo de guarda.
    expect(sql.length).toBeGreaterThan(2000);
    expect(sql).toContain("whatsapp_start_bot_message");
  });
});

describe("a porta de saída do robô", () => {
  /**
   * ⚠️ O CONTADOR DE NÃO LIDAS É O QUE ACENDE A FILA DO ATENDENTE.
   *
   * `whatsapp_start_outbound_message` (a do atendente) zera `unread_count`, com
   * a justificativa correta de que "responder é ler". Aplicada ao robô, essa
   * mesma linha faz a conversa DESAPARECER da aba "Não lidas" — e o associado
   * que escreveu "quero falar com alguém" recebe a frase de encaminhamento e
   * nunca mais é procurado.
   *
   * Ninguém veria: a caixa de entrada fica bonita, vazia e errada.
   */
  it("NÃO mexe em unread_count", () => {
    expect(
      corpoDaFuncao("whatsapp_start_bot_message"),
      "\n\nA função do robô passou a mexer em `unread_count`.\n\n" +
        "O robô respondendo zeraria o contador, e a conversa sumiria da aba\n" +
        '"Não lidas". Quem pediu atendimento humano nunca seria procurado.\n',
    ).not.toContain("unread_count");
  });

  it("grava com origem `bot`, e não `agent`", () => {
    // Com `agent`, o robô vira atendente no histórico — e a Central de
    // Atendimento passaria a mostrar produtividade de uma pessoa que não existe.
    const corpo = corpoDaFuncao("whatsapp_start_bot_message");
    expect(corpo).toContain("'bot'::public.whatsapp_message_origin");
    expect(corpo).not.toContain("'agent'::public.whatsapp_message_origin");
  });
});

describe("o silêncio do robô", () => {
  /**
   * ⚠️ INCLUIR `bot` NO GATILHO FARIA O ROBÔ SE CALAR AO RESPONDER. A primeira
   * resposta dele seria a última — por uma hora, e sem nada no log dizendo por
   * quê.
   */
  it("o gatilho reage a fala humana, e não à do próprio robô", () => {
    const gatilho = sql.slice(sql.indexOf("create trigger whatsapp_messages_pause_bot"));
    const quando = gatilho.slice(0, gatilho.indexOf("execute function"));

    expect(quando).toContain("'agent'");
    expect(quando).toContain("'phone'");
    expect(
      quando,
      "\n\nO gatilho passou a reagir a `bot`: o robô se calaria ao responder.\n",
    ).not.toContain("'bot'");
    expect(
      quando,
      "\n\nO gatilho passou a reagir a `contact`: toda mensagem de associado\n" +
        "calaria o robô, que então nunca responderia a ninguém.\n",
    ).not.toContain("'contact'");
  });

  /**
   * ⚠️ O DESVIO DO ECO. A Z-API devolve pelo webhook o que ela mesma acabou de
   * enviar a nosso pedido, e o id do fornecedor só é escrito na liquidação —
   * um eco que chegue antes disso entra como se fosse uma pessoa digitando no
   * celular, e calaria o robô por uma hora.
   */
  it("o gatilho ignora o eco do nosso próprio envio", () => {
    expect(
      corpoDaFuncao("whatsapp_pause_bot_on_human"),
      "\n\nO desvio do eco sumiu. O robô responderia a primeira mensagem e\n" +
        "ficaria mudo por uma hora — e nada no sistema acusaria.\n",
    ).toContain("provider_message_id is null");
  });

  it("grupo e atendimento humano aberto também calam", () => {
    const corpo = corpoDaFuncao("whatsapp_bot_should_answer");
    expect(corpo).toContain("not c.is_group");
    expect(corpo).toContain("chat_conversations");
    expect(corpo).toContain("bot_paused_until");
  });
});

describe("os privilégios", () => {
  /**
   * ⚠️ O SUPABASE DÁ `EXECUTE` A `anon` EM TODA FUNÇÃO NOVA do schema `public`
   * — inclusive nas `security definer`. Sem o `revoke`, qualquer pessoa com a
   * chave pública do projeto escreveria no histórico de conversas da APCS.
   */
  it("as três funções do robô são revogadas de anon e authenticated", () => {
    for (const funcao of [
      "whatsapp_start_bot_message",
      "whatsapp_pause_bot",
      "whatsapp_bot_should_answer",
    ]) {
      const revoke = new RegExp(
        `revoke execute on function public\\.${funcao}\\([^)]*\\)\\s*\\n?\\s*from public, anon, authenticated`,
      );

      expect(
        revoke.test(sql),
        `\n\n${funcao} não tem \`revoke ... from public, anon, authenticated\`.\n` +
          `O Supabase concede EXECUTE a \`anon\` em toda função nova — revogar não é\n` +
          `zelo, é desfazer um grant que ninguém pediu.\n`,
      ).toBe(true);

      expect(sql).toContain(`) to service_role;`);
    }
  });
});
