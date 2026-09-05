import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AS INVARIANTES DE LANDING PAGES E INSCRIÇÕES, LIDAS DO SQL.
 *
 * ⚠️ POR QUE UM TESTE DE TEXTO, E NÃO UM TESTE DE BANCO. Este projeto não roda
 * Postgres na bateria de testes: type-check, lint, build e as outras milhares de
 * asserções não executam uma linha de SQL. Uma migration que apagasse a
 * proteção do §12 aplicaria sem uma palavra, a tela abriria, a lista carregaria
 * — e o defeito só apareceria no dia em que duas pessoas se inscrevessem ao
 * mesmo tempo com o mesmo e-mail. É a mesma razão de `sql-returns-table` e
 * `sql-column-grants`, e as duas nasceram de defeitos que chegaram a produção.
 *
 * ⚠️ O QUE ELE NÃO É: um analisador de SQL. Cada caso responde UMA pergunta
 * objetiva, e é isso que o mantém quase sem falso positivo.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const sql = readFileSync(join(MIGRATIONS, "20260922000100_event_landing.sql"), "utf8");

/** O corpo de uma função `create or replace function public.<nome>`. */
function corpoDe(nome: string): string {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`);
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThan(-1);

  // Da declaração até o `$$;` que a fecha.
  const fim = sql.indexOf("\n$$;", inicio);
  expect(fim, `função ${nome} não tem fim`).toBeGreaterThan(inicio);
  return sql.slice(inicio, fim);
}

describe("§12 — evento + e-mail é único", () => {
  /**
   * ⚠️ ESTA É A GARANTIA, E A CHECAGEM EM PL/pgSQL NÃO É.
   *
   * `create_event_registration` confere "este e-mail já está inscrito" e dá o
   * texto certo — mas duas requisições simultâneas passam AS DUAS por aquela
   * conferência. Quem recusa a segunda é o índice. Apagá-lo deixaria a
   * checagem parecendo suficiente enquanto a regra teria virado uma sugestão.
   */
  it("existe um índice único sobre (event_id, email)", () => {
    expect(sql).toMatch(
      /create unique index event_participants_event_email_idx\s+on public\.event_participants \(event_id, email\)/,
    );
  });

  /**
   * ⚠️ INCONDICIONAL, E A DECISÃO ESTÁ DOCUMENTADA NA MIGRATION. Um `where
   * status = 'active'` liberaria o e-mail no cancelamento e parece mais gentil,
   * mas exigiria que o participante conhecesse a situação da INSCRIÇÃO — uma
   * segunda cópia do mesmo fato. Quem cancelou e quer voltar tem a inscrição
   * REATIVADA, que preserva o histórico do §13.
   */
  it("o índice não é parcial", () => {
    const indice = /create unique index event_participants_event_email_idx[^;]*;/.exec(sql)?.[0];
    expect(indice).toBeTruthy();
    expect(indice).not.toMatch(/\bwhere\b/i);
  });

  /**
   * O e-mail é guardado em minúsculas, e o índice conta com isso. Sem o CHECK,
   * uma chamada direta ao PostgREST gravaria "Joao@x.com" e a mesma pessoa
   * entraria duas vezes no mesmo evento — passando pelo índice, que compara
   * bytes.
   */
  it("o e-mail só pode ser gravado em minúsculas", () => {
    expect(sql).toContain("constraint event_participants_email_lower check (email = lower(email))");
  });
});

describe("a cópia de event_id é guardada por FK composta", () => {
  /**
   * ⚠️ É O QUE IMPEDE A DESNORMALIZAÇÃO DE VIRAR MENTIRA. `event_participants`
   * carrega `event_id` porque índice único não atravessa join (ver o §12 acima).
   * Sem estas duas FKs, seria possível gravar um participante apontando para um
   * evento diferente do da inscrição dele — e o índice do §12 passaria a
   * proteger o evento errado.
   */
  it("participante → inscrição carrega o evento junto", () => {
    expect(sql).toMatch(
      /constraint event_participants_registration_matches_event\s+foreign key \(registration_id, event_id\)\s+references public\.event_registrations \(id, event_id\)/,
    );
  });

  it("inscrição → landing page carrega o evento junto", () => {
    expect(sql).toMatch(
      /constraint event_registrations_landing_matches_event\s+foreign key \(landing_page_id, event_id\)\s+references public\.event_landing_pages \(id, event_id\)/,
    );
  });

  /** As chaves compostas de destino, sem as quais as FKs acima não compilam. */
  it("as chaves de destino existem", () => {
    expect(sql).toContain("constraint event_landing_pages_identity unique (id, event_id)");
    expect(sql).toContain("constraint event_registrations_identity unique (id, event_id)");
  });
});

describe("§13 — nada se apaga", () => {
  it("o DELETE é revogado nas três tabelas", () => {
    for (const tabela of ["event_landing_pages", "event_registrations", "event_participants"]) {
      expect(sql).toContain(`revoke delete on public.${tabela} from authenticated, anon;`);
    }
  });

  it("não existe policy de delete em nenhuma delas", () => {
    expect(sql).not.toMatch(/create policy[^;]*for delete/i);
  });

  /**
   * A trilha não se reescreve nem se apaga — e não aceita insert de fora. Quem
   * escreve nela são as funções SECURITY DEFINER, e o dono da tabela não passa
   * por RLS.
   */
  it("a trilha de inscrições é só de leitura pela API", () => {
    expect(sql).toContain(
      "revoke insert, update, delete on public.event_registration_audit_logs from authenticated, anon;",
    );
  });
});

describe("§28 — nada é exposto para anônimo", () => {
  /**
   * ⚠️ A PÁGINA PÚBLICA É O PROMPT 3, E O CAMINHO DELA NÃO É UMA POLICY DE
   * `anon`. É uma função SECURITY DEFINER estreita, chamada pelo servidor com
   * `service_role` — o mesmo desenho de `submit_membership_application`.
   *
   * A diferença prática: uma policy de `anon` libera a TABELA e depende de a
   * cláusula estar certa para sempre; a função libera UMA OPERAÇÃO, e o que ela
   * não faz é impossível de pedir. Abrir a tabela "já que vai precisar" deixaria
   * dado pessoal de terceiros exposto durante dois prompts inteiros.
   */
  it("nenhuma policy menciona anon", () => {
    const policies = sql.match(/create policy[^;]*;/gi) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy).not.toMatch(/\banon\b/);
    }
  });

  it("o acesso de anon é revogado explicitamente nas quatro tabelas", () => {
    for (const tabela of [
      "event_landing_pages",
      "event_registrations",
      "event_participants",
      "event_registration_audit_logs",
    ]) {
      expect(sql).toContain(`revoke all on public.${tabela} from anon;`);
    }
  });

  it("as quatro tabelas têm RLS ligada", () => {
    for (const tabela of [
      "event_landing_pages",
      "event_registrations",
      "event_participants",
      "event_registration_audit_logs",
    ]) {
      expect(sql).toContain(`alter table public.${tabela} enable row level security;`);
    }
  });
});

describe("create_event_registration", () => {
  const corpo = corpoDe("create_event_registration");

  /**
   * ⚠️ A ORDEM DAS CHECAGENS NÃO É ARBITRÁRIA, E ESTE É O CASO QUE ELA RESOLVE.
   *
   * Um retry (F5, rede ruim, duplo clique) chega com o mesmo `dedupe_key`
   * DEPOIS de a primeira tentativa ter gravado os participantes. Se as
   * validações rodassem antes, esse retry morreria em "e-mail já inscrito neste
   * evento" — acusando a pessoa de duplicidade contra ela mesma, e escondendo o
   * fato de que a inscrição dela deu certo.
   *
   * Trocar a ordem "para validar antes de consultar" é a refatoração que
   * parece limpeza e quebra a idempotência do §27.
   */
  it("confere a idempotência ANTES de validar os participantes", () => {
    const dedupe = corpo.indexOf("where r.dedupe_key = p_dedupe_key");
    const duplicidade = corpo.indexOf("errcode = 'RG003'");

    expect(dedupe).toBeGreaterThan(-1);
    expect(duplicidade).toBeGreaterThan(-1);
    expect(dedupe).toBeLessThan(duplicidade);
  });

  /**
   * ⚠️ O LOCK VEM ANTES DA CONTAGEM, e é o §15 inteiro. Sem ele, duas
   * inscrições simultâneas leem a mesma contagem, as duas concluem que cabem, e
   * o evento fecha acima da capacidade.
   */
  it("toma o lock da landing page antes de contar vagas", () => {
    const lock = corpo.indexOf("lock_event_landing_page");
    const contagem = corpo.indexOf("event_landing_participant_count");

    expect(lock).toBeGreaterThan(-1);
    expect(contagem).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(contagem);
  });

  /**
   * ⚠️ `origin` É DERIVADO DE QUEM CHAMA, NUNCA RECEBIDO. Um `p_origin` na
   * assinatura deixaria a página pública gravar 'backoffice' e mentir sobre a
   * procedência de toda inscrição — e ninguém conseguiria mais responder "de
   * onde veio esta pessoa?".
   */
  it("não aceita a origem como parâmetro", () => {
    const assinatura = corpo.slice(0, corpo.indexOf(")"));
    expect(assinatura).not.toContain("p_origin");
  });

  /** O `on conflict do nothing` é o que fecha a corrida entre dois envios idênticos. */
  it("a gravação é idempotente atomicamente", () => {
    expect(corpo).toContain("on conflict (dedupe_key) do nothing");
  });

  /**
   * SECURITY DEFINER porque quem chama pelo caminho público é o servidor com
   * `service_role`, sem sessão para a RLS avaliar. O que substitui a permissão
   * é a estreiteza da função.
   */
  it("é security definer, e o execute é revogado de anon", () => {
    expect(corpo).toContain("security definer");
    expect(sql).toMatch(
      /revoke execute on function public\.create_event_registration\([^)]*\)\s*\n?\s*from public, anon;/,
    );
  });
});

describe("§14 — a capacidade conta PESSOAS, não inscrições", () => {
  const corpo = corpoDe("event_landing_participant_count");

  it("conta participantes, atravessando as inscrições", () => {
    expect(corpo).toContain("from public.event_participants p");
    expect(corpo).toContain("join public.event_registrations r on r.id = p.registration_id");
  });

  /** Uma inscrição cancelada devolve as vagas dela ao evento. */
  it("ignora inscrição cancelada", () => {
    expect(corpo).toContain("r.status = 'active'");
  });
});

describe("§8 — telefone ou WhatsApp", () => {
  /**
   * No banco porque o escopo é explícito: "Essa regra deve existir no backend.
   * Não confiar somente na validação do frontend."
   */
  it("o CHECK impede a linha de existir sem nenhum dos dois", () => {
    expect(sql).toMatch(
      /constraint event_participants_needs_a_phone\s+check \(phone is not null or whatsapp is not null\)/,
    );
  });
});

describe("§20 — a trilha da landing page vai para a de EVENTOS", () => {
  /**
   * A Landing Page é 1:1 com o evento, e o ciclo dela é decisão de quem
   * responde pela agenda — mesma pessoa, mesma tela, mesmo histórico. O que
   * ganha tabela própria são as INSCRIÇÕES, porque `listEventAuditLogs` lê a
   * trilha do evento SEM LIMITE: um evento com 400 inscritos afogaria as cinco
   * linhas que interessam ali.
   */
  it("as operações de landing page gravam em event_audit_logs", () => {
    for (const acao of [
      "landing_page_created",
      "landing_page_updated",
      "landing_page_published",
      "landing_page_closed",
      "landing_page_deactivated",
    ]) {
      expect(sql).toContain(`'${acao}'`);
    }
    expect(sql).toContain("insert into public.event_audit_logs (event_id, action, metadata)");
  });
});
