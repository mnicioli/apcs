import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_MATRIX } from "@/lib/rbac/rbac.config";

/**
 * AS INVARIANTES DA AVALIAÇÃO DE EVENTO, LIDAS DO TEXTO DAS MIGRATIONS.
 *
 * ============================================================================
 * ⚠️ O QUE ESTE ARQUIVO É, E O QUE ELE HONESTAMENTE NÃO É.
 * ============================================================================
 * Este projeto NÃO sobe Postgres na bateria. Então a maior parte do escopo deste
 * módulo — só o presente recebe, uma resposta por participante, o token ser
 * imprevisível, a gravação ser transacional, a versão nova nascer sozinha — não
 * pode ser exercitada executando SQL aqui.
 *
 * O que dá para fazer, e é o que a bateria deste projeto já faz em nove outros
 * arquivos, é LER O TEXTO e cobrar a forma. É grosseiro, e é preciso, porque
 * cada caso responde uma pergunta só.
 *
 * ⚠️ E O MOTIVO DE VALER A PENA É O HISTÓRICO. O corpo de uma função PL/pgSQL só
 * é analisado na PRIMEIRA VEZ que cada comando roda: `create function` aceita
 * feliz, o type-check não fala com o Postgres, e os testes de action mockam o
 * Supabase — justamente quem recusaria. Neste módulo isso já custou um defeito
 * em produção no Prompt 1 (`set_participant_confirmation` nasceu SECURITY
 * INVOKER e não conseguia escrever na trilha; ver 20260927000000). Uma leitura
 * do arquivo é a única barreira que roda a cada commit.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const AVALIACAO = "20261002000100_event_evaluation.sql";
const ENUMS = "20261002000000_event_evaluation_enums.sql";

const sql = readFileSync(join(MIGRATIONS, AVALIACAO), "utf8");
const sqlEnums = readFileSync(join(MIGRATIONS, ENUMS), "utf8");

/**
 * O SQL sem os comentários.
 *
 * ⚠️ SEM ISTO O TESTE MENTE. As migrations deste projeto explicam cada decisão
 * em blocos longos de `--`, e vários deles CITAM comandos. Um regex que enxerga
 * comentário casaria com a prosa e aprovaria um arquivo que não faz nada do que
 * o comentário promete.
 */
function semComentarios(texto: string): string {
  return texto.replace(/--[^\n]*/g, "");
}

const codigo = semComentarios(sql);
const codigoEnums = semComentarios(sqlEnums);

/**
 * TODAS as migrations, na ordem em que o Postgres as aplica.
 *
 * ============================================================================
 * ⚠️ ELE EXISTE PORQUE ESTE ARQUIVO JÁ MENTIU UMA VEZ.
 * ============================================================================
 * As asserções liam só `20261002000100`. Quando o Prompt 4 recriou quatro
 * funções num arquivo novo (`20261004000000`), o texto antigo continuou aqui —
 * e os casos que cobravam "a gravação reconfere a presença" seguiram VERDES
 * sobre uma definição que o banco não usa mais.
 *
 * É o mesmo defeito que `sql-event-landing.test.ts` documenta com todas as
 * letras: "um teste verde sobre código morto". A diferença é que lá ele foi
 * pego pelo nome do arquivo, e aqui só apareceu porque a regra MUDOU de
 * propósito e alguém foi conferir.
 *
 * ⚠️ `create or replace` É O QUE TORNA ISSO POSSÍVEL. Uma função redefinida
 * numa migration posterior apaga a anterior no banco, e não no repositório —
 * então a ÚLTIMA definição, na ordem dos arquivos, é a única que vale.
 */
const TODAS = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort()
  .map((nome) => semComentarios(readFileSync(join(MIGRATIONS, nome), "utf8")))
  .join("\n");

/**
 * O corpo da função COMO O BANCO A TEM — a última definição de todas as
 * migrations, e não a deste arquivo.
 */
function corpoDe(nome: string): string {
  const inicio = TODAS.lastIndexOf(`create or replace function public.${nome}(`);
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThan(-1);
  const fim = TODAS.indexOf("\n$$;", inicio);
  expect(fim, `função ${nome} não tem fim`).toBeGreaterThan(inicio);
  return TODAS.slice(inicio, fim);
}

/** O bloco `create table public.<nome> ( ... );`. */
function tabelaDe(nome: string): string {
  const inicio = codigo.indexOf(`create table if not exists public.${nome} (`);
  expect(inicio, `tabela ${nome} não encontrada`).toBeGreaterThan(-1);
  const fim = codigo.indexOf("\n);", inicio);
  expect(fim, `tabela ${nome} não tem fim`).toBeGreaterThan(inicio);
  return codigo.slice(inicio, fim);
}

describe("a bateria está lendo o que acha que está lendo", () => {
  it("os dois arquivos da avaliação existem", () => {
    const naPasta = readdirSync(MIGRATIONS);
    expect(naPasta).toContain(AVALIACAO);
    expect(naPasta).toContain(ENUMS);
    expect(codigo.length).toBeGreaterThan(20_000);
  });

  it("os comentários foram removidos antes das asserções", () => {
    // O arquivo TEM prosa; o que é lido pelas asserções, não.
    expect(sql).toContain("-- ");
    expect(codigo).not.toContain("-- ");
  });

  /**
   * ⚠️ A ARMADILHA DO ENUM, GUARDADA AQUI TAMBÉM. `alter type ... add value` e o
   * USO do valor novo não podem dividir transação. Estes três são `create type`
   * (nascem usáveis no mesmo arquivo), mas ficam separados para que o dia em que
   * um valor for ACRESCENTADO já encontre o arquivo pronto.
   */
  it("os enums moram no arquivo anterior, e o de avaliação não cria tipo nenhum", () => {
    expect(codigoEnums).toContain("create type public.event_evaluation_question_type");
    expect(codigoEnums).toContain("create type public.event_evaluation_status");
    expect(codigoEnums).toContain("create type public.event_evaluation_audit_action");
    expect(codigo).not.toMatch(/create\s+type\s+public\.event_evaluation/);
  });
});

/* ========================================================================== */
/* §31 — a modelagem                                                          */
/* ========================================================================== */

describe("§31 — as tabelas que o escopo pede", () => {
  it("as nove tabelas existem", () => {
    for (const tabela of [
      "event_evaluations",
      "event_evaluation_versions",
      "event_evaluation_sections",
      "event_evaluation_questions",
      "event_evaluation_options",
      "event_evaluation_settings",
      "event_participant_evaluations",
      "event_evaluation_answers",
      "event_evaluation_audit_logs",
    ]) {
      expect(codigo, `falta a tabela ${tabela}`).toContain(
        `create table if not exists public.${tabela} (`,
      );
    }
  });

  /**
   * ⚠️ `event_id` NULO É O MODELO DA CASA (decisão 1). Sem esta coluna, template
   * reutilizável e avaliação de evento seriam duas tabelas — e o construtor do
   * §24 teria de existir duas vezes, ou funcionar só numa delas.
   */
  it("o modelo reutilizável é uma linha com event_id nulo", () => {
    const tabela = tabelaDe("event_evaluations");
    expect(tabela).toMatch(/event_id\s+uuid\s+unique\s+references\s+public\.events/);
    expect(tabela).toContain("is_default boolean not null default false");
  });

  it("um modelo padrão de cada vez, e ele nunca pertence a um evento", () => {
    expect(codigo).toMatch(
      /create unique index if not exists event_evaluations_single_default_idx[\s\S]*?where is_default/,
    );
    expect(tabelaDe("event_evaluations")).toMatch(
      /event_evaluations_default_is_global[\s\S]*?not is_default or event_id is null/,
    );
  });

  it("a versão é numerada e única dentro da avaliação (§23)", () => {
    const tabela = tabelaDe("event_evaluation_versions");
    expect(tabela).toContain("version integer not null");
    expect(tabela).toMatch(/unique\s*\(evaluation_id,\s*version\)/);
  });

  /**
   * ⚠️ `restrict`, E NÃO `cascade`. Apagar uma versão que já foi respondida
   * levaria as respostas junto — e o §19 proíbe exclusão física de resposta. O
   * banco recusa, e recusar é a resposta certa.
   */
  it("a versão respondida não pode ser apagada por engano", () => {
    const tabela = tabelaDe("event_participant_evaluations");
    expect(tabela).toMatch(
      /version_id uuid not null\s+references public\.event_evaluation_versions on delete restrict/,
    );
    expect(tabela).toMatch(
      /evaluation_id uuid not null references public\.event_evaluations on delete restrict/,
    );
  });
});

/* ========================================================================== */
/* §5, §32 — a escala estruturada                                             */
/* ========================================================================== */

describe("§5 e §32 — a escala é dado estruturado", () => {
  it("a alternativa guarda rótulo E valor numérico", () => {
    const tabela = tabelaDe("event_evaluation_options");
    expect(tabela).toContain("label text not null");
    expect(tabela).toContain("numeric_value integer");
  });

  /**
   * ⚠️ A RESPOSTA GUARDA O VALOR COPIADO, e não só o ponteiro para a opção
   * (decisão 4). É o §5 pedindo que a escala possa mudar sem quebrar resposta
   * existente: sem a cópia, trocar "3 — Regular" por "3 — Neutro" com peso 2
   * reescreveria em silêncio a média de todos os eventos passados.
   */
  it("a resposta guarda o valor numérico ALÉM da opção escolhida", () => {
    const tabela = tabelaDe("event_evaluation_answers");
    expect(tabela).toContain("option_id uuid references public.event_evaluation_options");
    expect(tabela).toContain("numeric_value integer");
    expect(tabela).toContain("text_value text");
  });

  it("resposta vazia não é resposta — o CHECK exige conteúdo", () => {
    expect(tabelaDe("event_evaluation_answers")).toMatch(
      /event_evaluation_answers_has_content[\s\S]*?option_id is not null[\s\S]*?numeric_value is not null[\s\S]*?text_value is not null/,
    );
  });

  /**
   * ⚠️ O `numeric_value` VEM DA OPÇÃO, E NUNCA DO PARÂMETRO. A página é pública:
   * aceitar o número de fora deixaria qualquer pessoa mandar "10" numa escala de
   * 5 e envenenar a média do Prompt 3 sem precisar de permissão nenhuma.
   */
  it("a gravação copia o valor da opção, e não o recebe no payload", () => {
    const corpo = corpoDe("submit_event_evaluation");
    expect(corpo).toMatch(
      /select[\s\S]*?o\.numeric_value[\s\S]*?from public\.event_evaluation_options o/,
    );
    expect(corpo).not.toMatch(/v_resposta\s*->>\s*'value'/);
    expect(corpo).not.toMatch(/v_resposta\s*->>\s*'numericValue'/);
  });
});

/* ========================================================================== */
/* §10 — o disparo depende do EVENTO                                          */
/* ========================================================================== */

describe("§10 — término do evento + atraso", () => {
  /**
   * ⚠️ O FUSO É EXPLÍCITO. `event_date` é `date` e `end_time` é `time`; juntá-los
   * dá um `timestamp` SEM fuso, que o Postgres interpretaria no fuso do SERVIDOR
   * (UTC, na Supabase). "Termina às 18:00" viraria 15:00 em São Paulo — três
   * horas de erro, exatamente o defeito que 20260925000200 já custou.
   */
  it("a conta usa America/Sao_Paulo, e não o fuso do servidor", () => {
    const corpo = corpoDe("event_evaluation_send_at");
    expect(corpo).toContain("at time zone 'America/Sao_Paulo'");
    expect(corpo).toContain("e.event_date + e.end_time");
  });

  it("sem horário de término a conta devolve nulo, e não um palpite", () => {
    expect(corpoDe("event_evaluation_send_at")).toMatch(/when e\.end_time is null then null/);
  });

  /**
   * ⚠️ O DISPARO É RELACIONADO AO EVENTO, e não ao check-in de cada pessoa. O
   * §10 é explícito: "não calcular o término baseado no momento do check-in".
   */
  it("o agendamento não olha para `checked_in_at`", () => {
    expect(corpoDe("schedule_event_evaluations")).not.toContain("checked_in_at");
  });

  it("habilitar sem horário de término é recusado com AV001", () => {
    expect(corpoDe("save_event_evaluation_settings")).toMatch(
      /v_event\.end_time is null[\s\S]*?errcode = 'AV001'/,
    );
  });

  it("o agendador também pula evento sem término — ele pode ser apagado depois", () => {
    expect(corpoDe("schedule_event_evaluations")).toContain("e.end_time is not null");
  });
});

/* ========================================================================== */
/* §11 — SOMENTE PRESENTES                                                    */
/* ========================================================================== */

describe("§11 — a regra crítica: só quem esteve presente", () => {
  const corpo = corpoDe("schedule_event_evaluations");

  it("o filtro é `p.present`", () => {
    expect(corpo).toMatch(/from public\.event_participants p[\s\S]*?and p\.present/);
  });

  /**
   * ⚠️ ESTE É O CASO QUE COSTUMA SER IMPLEMENTADO ERRADO: "Confirmado OFF +
   * Presente ON → RECEBE". Ele sai de graça porque a coluna `confirmation`
   * simplesmente não é lida por esta função — e é isso que o teste cobra.
   */
  it("a confirmação NÃO entra na conta, em lugar nenhum da função", () => {
    expect(corpo).not.toContain("confirmation");
  });

  /**
   * ⚠️ ESTES CASOS FORAM INVERTIDOS PELO PROMPT 4, e a inversão é a correção —
   * não uma regressão.
   *
   * O Prompt 2 conferia a presença em quatro lugares, achando que mais barreiras
   * era mais seguro. O §34 do Prompt 4 mostrou que não: "não cancelar
   * automaticamente a avaliação enviada". Uma pessoa que recebeu o link e teve a
   * presença corrigida por engano na segunda-feira batia num "esta avaliação não
   * está disponível" — a correção administrativa virava revogação silenciosa de
   * um convite já entregue.
   *
   * A regra passou a ter hora:
   *
   *     A PRESENÇA DECIDE SE O CONVITE SAI.   (schedule, claim)
   *     DEPOIS QUE SAIU, O CONVITE VALE.      (público, submit)
   *
   * ⚠️ E ISSO NÃO AFROUXA NADA: quem nunca esteve presente nunca teve linha
   * criada, logo nunca teve token, logo não alcança a página pública. O portão
   * que saiu daqui protegia um caso que não existe; o que ele fazia de verdade
   * era invalidar convites legítimos.
   */
  it("a leitura pública NÃO julga a presença (§34 do Prompt 4)", () => {
    expect(corpoDe("get_public_event_evaluation")).not.toMatch(/v_participant\.present/);
  });

  it("a gravação NÃO julga a presença — o convite saiu, a resposta vale (§34)", () => {
    expect(corpoDe("submit_event_evaluation")).not.toMatch(/v_participant\.present/);
  });

  /**
   * ⚠️ MAS O PARTICIPANTE CONTINUA SENDO EXIGIDO. Sem a linha dele não há a quem
   * atribuir a resposta — e isso é integridade referencial, não julgamento de
   * presença.
   */
  it("a gravação continua exigindo que o participante exista", () => {
    expect(corpoDe("submit_event_evaluation")).toMatch(
      /from public\.event_participants p\s*where p\.id = v_row\.participant_id and p\.event_id = v_row\.event_id/,
    );
  });

  /**
   * ⚠️ E O PORTÃO NÃO SUMIU: ELE SUBIU PARA A REIVINDICAÇÃO (§33). "O job deve
   * consultar o estado atual da presença no momento do processamento" — entre
   * criar a linha e mandar a mensagem passam um arrendamento de dez minutos e
   * quantas passadas forem precisas, tempo de sobra para uma correção acontecer
   * e ser ignorada.
   */
  it("a reivindicação reconfere presença E avaliação habilitada (§3, §33)", () => {
    const corpo = corpoDe("claim_event_evaluations");
    expect(corpo).toMatch(
      /join public\.event_participants p\s*on p\.id = pe\.participant_id and p\.event_id = pe\.event_id/,
    );
    expect(corpo).toContain("and p.present");
    expect(corpo).toContain("and s.enabled");
  });

  /**
   * ⚠️ A ELEGIBILIDADE MORA NO BANCO, E NÃO NO WORKER. Um `if (present)` em
   * TypeScript seria uma segunda cópia da regra mais importante do módulo, e a
   * cópia é o que envelhece.
   */
  it("o formulário vazio não sai — link para uma página em branco custa uma conversa", () => {
    expect(corpo).toMatch(
      /v_version is null or not exists[\s\S]*?event_evaluation_sections[\s\S]*?continue;/,
    );
  });
});

/* ========================================================================== */
/* §7, §34 — o token                                                          */
/* ========================================================================== */

describe("§7 e §34 — o token", () => {
  /**
   * ⚠️ NEM SEQUENCIAL, NEM DERIVADO DA PESSOA. Um token derivado do e-mail ou do
   * id seria adivinhável por quem conhece os dois — que é exatamente quem não
   * deveria conseguir responder no lugar de outra pessoa.
   */
  it("nasce de um gerador aleatório, e não de nada do participante", () => {
    const corpo = corpoDe("schedule_event_evaluations");

    /**
     * ⚠️ A ASSERÇÃO É SOBRE A LINHA QUE GERA O TOKEN, e não sobre a vizinhança.
     * A primeira versão procurava `p.email` ou `p.id` perto da palavra "token" e
     * acusava o `insert` inteiro — que lista `p.id` como `participant_id` três
     * linhas abaixo, legitimamente. Um teste que acusa código correto é um teste
     * que alguém desliga.
     */
    const linhaDoToken = corpo.split("\n").find((linha) => linha.includes("gen_random_uuid"));

    expect(linhaDoToken, "a geração do token sumiu da função").toBeDefined();
    expect(linhaDoToken).toContain("replace(gen_random_uuid()::text, '-', '')");
    // Nada da pessoa entra na composição: o token não é derivado, é sorteado.
    expect(linhaDoToken).not.toMatch(/\bp\.(email|id|full_name|whatsapp|phone)\b/);
  });

  it("é único no banco inteiro", () => {
    expect(codigo).toContain(
      "create unique index if not exists event_participant_evaluations_token_idx",
    );
  });

  it("tem comprimento mínimo imposto por CHECK", () => {
    expect(tabelaDe("event_participant_evaluations")).toMatch(
      /event_participant_evaluations_token_len[\s\S]*?char_length\(token\) >= 24/,
    );
  });

  /**
   * ⚠️ NEM QUEM PODE LER A TABELA VÊ O TOKEN. A tela de gestão mostra situação,
   * data e tentativas — nunca o link. Quem precisa dele é a rotina de envio
   * (`service_role`) e a página pública, que o recebe pela URL.
   */
  it("a coluna do token é revogada até de quem pode ler a tabela", () => {
    expect(codigo).toContain(
      "revoke select (token) on public.event_participant_evaluations from authenticated, anon",
    );
  });

  it("o token nunca entra na trilha", () => {
    const trilha = codigo.match(/insert into public\.event_evaluation_audit_logs[\s\S]*?;/g) ?? [];
    expect(trilha.length).toBeGreaterThan(4);
    for (const bloco of trilha) {
      expect(bloco, "uma trilha está guardando o token").not.toContain("token");
    }
  });

  /**
   * ⚠️ TOKEN DESCONHECIDO NÃO LEVANTA EXCEÇÃO (§33). Devolve `not_found`, a
   * mesma forma de uma avaliação cancelada — um erro distinto seria um oráculo:
   * quem estivesse adivinhando saberia quando acertou o formato.
   */
  it("token desconhecido devolve um estado, e não um erro", () => {
    const corpo = corpoDe("get_public_event_evaluation");
    expect(corpo).toMatch(
      /if not found then[\s\S]{0,120}return jsonb_build_object\('state', 'not_found'\)/,
    );
    expect(corpo).not.toContain("raise exception");
  });

  it("nada pessoal sai antes de o token ser validado", () => {
    const corpo = corpoDe("get_public_event_evaluation");
    const primeiroSelect = corpo.indexOf("where pe.token");
    const nome = corpo.indexOf("full_name");
    expect(primeiroSelect).toBeGreaterThan(-1);
    expect(nome).toBeGreaterThan(primeiroSelect);
  });

  /**
   * ⚠️ O PRIMEIRO NOME, E NÃO O COMPLETO (§29, §33). A página é aberta por um
   * link que pode ser reencaminhado: "Olá, João" cumpre o §29 sem entregar o
   * nome inteiro a quem receber o endereço de segunda mão.
   */
  it("a página pública recebe só o primeiro nome", () => {
    expect(corpoDe("get_public_event_evaluation")).toContain(
      "split_part(btrim(coalesce(v_participant.full_name, '')), ' ', 1)",
    );
  });
});

/* ========================================================================== */
/* §15, §18 — idempotência e resposta única                                   */
/* ========================================================================== */

describe("§15 e §18 — uma avaliação, uma resposta", () => {
  /**
   * ⚠️ NÃO É UMA CHECAGEM QUE O JOB FAZ: é uma impossibilidade. Duas execuções
   * simultâneas do agendador esbarram aqui, e a segunda perde.
   */
  it("o índice único (evento, participante) existe", () => {
    expect(codigo).toMatch(
      /create unique index if not exists event_participant_evaluations_unique_idx\s+on public\.event_participant_evaluations \(event_id, participant_id\)/,
    );
  });

  it("o agendamento conta com o índice em vez de conferir antes", () => {
    expect(corpoDe("schedule_event_evaluations")).toContain(
      "on conflict (event_id, participant_id) do nothing",
    );
  });

  it("a resposta de uma pergunta não se repete dentro da mesma rodada", () => {
    expect(codigo).toMatch(
      /create unique index if not exists event_evaluation_answers_unique_idx\s+on public\.event_evaluation_answers \(participant_evaluation_id, round, question_id, option_id\)\s+nulls not distinct/,
    );
  });

  /**
   * ⚠️ `nulls not distinct` É O QUE FAZ O ÍNDICE VALER PARA TEXTO LIVRE. Por
   * padrão o Postgres considera dois nulos DIFERENTES, então (avaliação,
   * pergunta, null) não colidiria com ela mesma e um comentário poderia ser
   * gravado duas vezes.
   */
  it("o índice trata nulos como iguais — senão o comentário duplicaria", () => {
    expect(codigo).toContain("nulls not distinct");
  });

  it("já respondida é recusada com AV004, e a anterior não é sobrescrita", () => {
    const corpo = corpoDe("submit_event_evaluation");
    expect(corpo).toMatch(/v_row\.status = 'answered'[\s\S]{0,200}errcode = 'AV004'/);
    expect(corpo).not.toContain("delete from public.event_evaluation_answers");
  });

  /**
   * ⚠️ O `for update` É O §30 ("concorrência em submissão"). Dois envios
   * simultâneos chegam os dois; o primeiro tranca a linha e o segundo espera —
   * e quando entra, encontra `answered`. Sem o lock, os dois passariam pela
   * checagem de situação antes de qualquer um gravar.
   */
  it("a submissão tranca a linha antes de decidir", () => {
    expect(corpoDe("submit_event_evaluation")).toMatch(
      /where pe\.token = btrim\(p_token\)\s+for update/,
    );
  });

  /**
   * ⚠️ E TEM A SEGUNDA BARREIRA: o `where pe.status <> 'answered'` no UPDATE. Se
   * ele não casar com linha nenhuma, alguém respondeu no intervalo — e o `raise`
   * desfaz as respostas já gravadas nesta transação.
   */
  it("a reivindicação da situação é compare-and-set", () => {
    expect(corpoDe("submit_event_evaluation")).toMatch(
      /set status = 'answered'[\s\S]*?and pe\.status <> 'answered'[\s\S]*?returning pe\.id into v_reivindicada/,
    );
  });
});

/* ========================================================================== */
/* §19 — reabrir sem apagar                                                   */
/* ========================================================================== */

describe("§19 — a reabertura não apaga histórico", () => {
  it("existe a rodada, na avaliação e na resposta", () => {
    expect(tabelaDe("event_participant_evaluations")).toContain(
      "answer_round integer not null default 1",
    );
    expect(tabelaDe("event_evaluation_answers")).toContain("round integer not null default 1");
  });

  /**
   * ⚠️ O §19 PROÍBE EXCLUSÃO FÍSICA DA RESPOSTA. Sem um discriminador, a resposta
   * nova bateria no índice único da antiga — a mesma pessoa, a mesma pergunta, a
   * mesma opção. Reabrir INCREMENTA a rodada; a rodada 1 fica onde está.
   */
  it("reabrir incrementa a rodada e não apaga resposta nenhuma", () => {
    const corpo = corpoDe("reopen_event_evaluation");
    expect(corpo).toContain("answer_round = pe.answer_round + 1");
    expect(corpo).not.toContain("delete from");
  });

  it("reabrir exige permissão de escrita, e não a de envio", () => {
    expect(corpoDe("reopen_event_evaluation")).toContain("public.evaluations_is_writer()");
    expect(corpoDe("resend_event_evaluation")).toContain("public.evaluations_is_sender()");
  });

  it("só uma avaliação já respondida pode ser reaberta", () => {
    expect(corpoDe("reopen_event_evaluation")).toMatch(
      /v_row\.status <> 'answered'[\s\S]{0,200}errcode = 'AV003'/,
    );
  });

  it("a gravação usa a rodada corrente, e não um 1 fixo", () => {
    const corpo = corpoDe("submit_event_evaluation");
    expect(corpo).toContain("v_row.answer_round");
    expect(corpo).toMatch(/a\.round = v_row\.answer_round/);
  });
});

/* ========================================================================== */
/* §17 — reenvio                                                              */
/* ========================================================================== */

describe("§17 — o reenvio", () => {
  const corpo = corpoDe("resend_event_evaluation");

  /**
   * ⚠️ O TOKEN NÃO É TROCADO (decisão 5). Um reenvio acontece justamente quando
   * o primeiro envio ficou em dúvida — e se a primeira mensagem tiver chegado,
   * rodar o token deixaria a pessoa com um link morto na mão.
   */
  it("não gera token novo", () => {
    expect(corpo).not.toContain("token =");
    expect(corpo).not.toContain("gen_random_uuid");
  });

  it("não cria resposta nenhuma", () => {
    expect(corpo).not.toContain("event_evaluation_answers");
  });

  it("zera as tentativas e o último erro, e devolve a linha para a fila", () => {
    expect(corpo).toMatch(/set status = 'scheduled'[\s\S]*?attempts = 0[\s\S]*?last_error = null/);
  });

  it("recusa quem já respondeu (AV004) e quem passou do prazo (AV005)", () => {
    expect(corpo).toMatch(/'answered'[\s\S]{0,200}errcode = 'AV004'/);
    expect(corpo).toMatch(/expires_at[\s\S]{0,200}errcode = 'AV005'/);
  });

  /**
   * ⚠️ §28 — A CADEIA. `p_participant_evaluation_id` vem do navegador; sem o
   * `and pe.event_id = p_event_id`, um id trocado reenviaria o convite de OUTRO
   * evento — e a tela de origem nunca mostraria nada de errado.
   */
  it("confere que a avaliação é DESTE evento", () => {
    for (const fn of [
      "resend_event_evaluation",
      "cancel_event_evaluation",
      "reopen_event_evaluation",
    ]) {
      expect(corpoDe(fn), `${fn} não confere a cadeia`).toMatch(
        /where pe\.id = p_participant_evaluation_id\s+and pe\.event_id = p_event_id/,
      );
    }
  });
});

/* ========================================================================== */
/* §16 — falha de envio                                                       */
/* ========================================================================== */

describe("§16 — a falha no envio", () => {
  /**
   * ⚠️ "ENVIADA" EXIGE O ID DO FORNECEDOR. É o §16 ("não marcar como ENVIADA se
   * o provider não confirmar") escrito no lugar onde ele não pode ser esquecido.
   */
  it("o carimbo de envio grava o id do fornecedor", () => {
    expect(corpoDe("mark_event_evaluation_sent")).toContain("provider_message_id");
  });

  /**
   * ⚠️ O `where` NÃO INCLUI `answered`. Uma pessoa pode responder ANTES de a
   * rotina conseguir gravar o resultado do envio. Sem esta condição, o carimbo
   * reverteria a resposta dela para "enviada" e a taxa do §21 diria que ninguém
   * respondeu.
   */
  it("o carimbo não sobrescreve quem já respondeu", () => {
    expect(corpoDe("mark_event_evaluation_sent")).toContain(
      "and pe.status in ('pending', 'scheduled')",
    );
  });

  it("a falha registra motivo e tentativa na trilha", () => {
    const corpo = corpoDe("mark_event_evaluation_failed");
    expect(corpo).toContain("last_error");
    expect(corpo).toContain("'invitation_failed'");
    expect(corpo).toContain("'attempts'");
  });

  /**
   * ⚠️ FALHA É TENTATIVA, E NÃO DESTINO. A linha continua `scheduled` e a próxima
   * passada a pega de novo. Um estado terminal de falha exigiria alguém para
   * tirá-la de lá — e é exatamente o tipo de fila que ninguém olha.
   */
  it("a falha NÃO muda a situação", () => {
    expect(corpoDe("mark_event_evaluation_failed")).not.toMatch(/set[\s\S]{0,80}status =/);
  });

  it("o motivo da falha é truncado antes de entrar na trilha", () => {
    expect(corpoDe("mark_event_evaluation_failed")).toMatch(/left\(coalesce\(p_error, ''\), 200\)/);
  });

  it("existe teto de tentativas na reivindicação", () => {
    expect(corpoDe("claim_event_evaluations")).toContain("pe.attempts < 5");
  });

  /**
   * ⚠️ O ARRENDAMENTO SUBSTITUI UM ESTADO "ENVIANDO". Não existe estado do qual
   * seja possível ficar preso, então não existe rotina de destravamento para
   * esquecer de chamar.
   */
  it("a reivindicação usa `skip locked` e arrendamento de dez minutos", () => {
    const corpo = corpoDe("claim_event_evaluations");
    // ⚠️ `of pe` desde o Prompt 4: a CTE ganhou dois joins (§33), e sem
    // qualificar a tabela o Postgres tentaria travar `event_participants` e
    // `event_evaluation_settings` junto — travando a lista de presença inteira
    // a cada passada do disparo.
    expect(corpo).toContain("for update of pe skip locked");
    expect(corpo).toContain("now() - interval '10 minutes'");
  });
});

/* ========================================================================== */
/* §20 — expiração                                                            */
/* ========================================================================== */

describe("§20 — o prazo", () => {
  /**
   * ⚠️ A ROTINA DE EXPIRAÇÃO NÃO É O PORTÃO. Quem recusa uma resposta fora do
   * prazo é `submit_event_evaluation`, comparando `expires_at` com `now()` na
   * hora. Uma regra que depende de um cron ter rodado é uma regra que falha em
   * silêncio quando o cron para.
   */
  it("a submissão confere o prazo na hora, sem depender da rotina", () => {
    expect(corpoDe("submit_event_evaluation")).toMatch(
      /v_row\.expires_at is not null and v_row\.expires_at <= now\(\)[\s\S]{0,200}errcode = 'AV005'/,
    );
  });

  it("a leitura pública também confere o prazo na hora", () => {
    expect(corpoDe("get_public_event_evaluation")).toMatch(
      /v_row\.expires_at is not null and v_row\.expires_at <= now\(\)/,
    );
  });

  it("sem prazo configurado, `expires_at` fica nulo", () => {
    expect(corpoDe("schedule_event_evaluations")).toMatch(
      /when v_evento\.response_window_days is null then null/,
    );
  });
});

/* ========================================================================== */
/* §23 — versionamento                                                        */
/* ========================================================================== */

describe("§23 — a versão nova nasce sozinha", () => {
  const corpo = corpoDe("save_event_evaluation_structure");

  /**
   * ⚠️ QUEM DECIDE É O BANCO, e não a tela. "Nunca alterar silenciosamente a
   * estrutura de uma avaliação que já possui respostas" — deixar essa decisão
   * para a tela significaria que uma segunda tela, ou uma chamada direta ao
   * PostgREST, a tomaria diferente.
   */
  it("com resposta na versão corrente, cria uma v+1 em vez de reescrever", () => {
    expect(corpo).toMatch(
      /exists \(\s*select 1 from public\.event_participant_evaluations pe\s*where pe\.version_id = v_current and pe\.status = 'answered'\s*\)/,
    );
    expect(corpo).toMatch(/max\(v\.version\), 0\) \+ 1/);
  });

  it("sem resposta, reescreve a versão corrente", () => {
    expect(corpo).toMatch(
      /v_target := v_current;\s*delete from public\.event_evaluation_sections s where s\.version_id = v_target;/,
    );
  });

  it("a trilha distingue 'perguntas alteradas' de 'nova versão publicada'", () => {
    expect(corpo).toContain(
      "case when v_versionou then 'version_published' else 'structure_changed' end",
    );
  });

  it("trocar o MODELO é recusado quando já há resposta (§22)", () => {
    expect(corpoDe("apply_evaluation_template")).toMatch(
      /status = 'answered'[\s\S]{0,300}errcode = 'AV004'/,
    );
  });

  /**
   * ⚠️ O EVENTO NUNCA APONTA PARA O MODELO DA CASA. Apontar seria mais barato e
   * editaria as perguntas de todos os eventos ao mesmo tempo, inclusive os já
   * respondidos.
   */
  it("habilitar CLONA o modelo em vez de apontar para ele", () => {
    const corpo = corpoDe("ensure_event_evaluation");
    expect(corpo).toContain("insert into public.event_evaluations (event_id");
    expect(corpo).toContain(
      "perform public.clone_evaluation_version(v_template_version, v_version)",
    );
  });

  it("só um modelo de verdade pode ser clonado — não a avaliação de outro evento", () => {
    expect(corpoDe("ensure_event_evaluation")).toMatch(
      /t\.id = v_template and t\.event_id is null[\s\S]{0,200}errcode = 'AV003'/,
    );
  });
});

/* ========================================================================== */
/* §24, §25 — a estrutura e as obrigatórias                                   */
/* ========================================================================== */

describe("§24 e §25 — o que o banco recusa na estrutura", () => {
  const corpo = corpoDe("save_event_evaluation_structure");

  it("recusa avaliação sem bloco", () => {
    expect(corpo).toMatch(/jsonb_array_length\(p_sections\) = 0[\s\S]{0,200}errcode = 'AV003'/);
  });

  it("recusa bloco sem título e bloco sem pergunta", () => {
    expect(corpo).toMatch(/Todo bloco precisa de um título[\s\S]{0,120}errcode = 'AV003'/);
    expect(corpo).toMatch(/está sem perguntas[\s\S]{0,120}errcode = 'AV003'/);
  });

  it("recusa tipo de pergunta desconhecido", () => {
    expect(corpo).toMatch(
      /v_tipo not in \('rating', 'single_choice', 'multiple_choice', 'yes_no', 'free_text'\)/,
    );
  });

  it("recusa alternativa de nota sem valor (§5)", () => {
    expect(corpo).toMatch(
      /v_tipo = 'rating' and \(v_opcao ->> 'value'\) is null[\s\S]{0,200}errcode = 'AV003'/,
    );
  });

  /**
   * ⚠️ AS ALTERNATIVAS DE SIM/NÃO SÃO GERADAS AQUI, e o que vier no payload é
   * ignorado. Sem isso, cada avaliação teria a sua própria grafia de
   * "Sim"/"sim"/"SIM" e a tabulação do Prompt 3 teria de adivinhar quais são a
   * mesma resposta.
   */
  it("Sim/Não tem as alternativas geradas pelo banco, com valores fixos", () => {
    expect(corpo).toContain("values (v_pergunta_id, 1, 'Sim', 1), (v_pergunta_id, 2, 'Não', 0)");
  });

  /**
   * ⚠️ A NUMERAÇÃO VEM DE `ordinality`, e não de um contador da função. É o que
   * garante que `position` nunca empate — do que `clone_evaluation_version`
   * depende para parear origem e destino.
   */
  it("a posição vem da ordem do array recebido", () => {
    expect(corpo).toContain("with ordinality");
    expect(corpo).not.toMatch(/p_sections[\s\S]{0,200}->>\s*'position'/);
  });

  /**
   * ⚠️ AS OBRIGATÓRIAS SÃO CONFERIDAS CONTRA O QUE FOI GRAVADO, e não contra o
   * payload. É o que torna a checagem imune a um payload que mande a chave certa
   * com conteúdo vazio, e a um tipo de pergunta novo que alguém esqueça de
   * tratar no laço.
   */
  it("as obrigatórias são conferidas contra as linhas gravadas (§25)", () => {
    const submissao = corpoDe("submit_event_evaluation");
    expect(submissao).toMatch(
      /where s\.version_id = v_row\.version_id\s*and q\.required\s*and not exists[\s\S]*?from public\.event_evaluation_answers a/,
    );
    expect(submissao).toMatch(/errcode = 'AV006'/);
  });

  it("a pergunta respondida tem de ser DESTA versão (§28, §29)", () => {
    expect(corpoDe("submit_event_evaluation")).toMatch(
      /where s\.version_id = v_row\.version_id\s+and q\.id = \(v_resposta ->> 'questionId'\)::uuid/,
    );
  });

  it("a alternativa tem de ser DESTA pergunta", () => {
    expect(corpoDe("submit_event_evaluation")).toMatch(
      /o\.id = v_option_id and o\.question_id = v_question\.id/,
    );
  });

  it("escolha única recusa duas alternativas", () => {
    expect(corpoDe("submit_event_evaluation")).toMatch(
      /v_question\.question_type <> 'multiple_choice' and jsonb_array_length\(v_opcoes\) > 1/,
    );
  });
});

/* ========================================================================== */
/* §3 — o modelo padrão da APCS                                               */
/* ========================================================================== */

describe("§3 — o modelo padrão", () => {
  it("é semeado com os cinco blocos do formulário de referência", () => {
    expect(codigo).toContain("'Pesquisa de opinião — modelo APCS'");
    expect(codigo).toContain("'Infraestrutura'");
    expect(codigo).toContain("'Avaliação geral'");
    expect(codigo).toContain("'Comentários adicionais'");
  });

  /**
   * ⚠️ "EMPRESA 1" E "EMPRESA 2", E NÃO "DNA" E "ALIVIRA". O §3 é explícito: a
   * estrutura do formulário atual é a REFERÊNCIA, mas as empresas não podem
   * ficar fixas na arquitetura.
   */
  it("NÃO fixa DNA nem Alivira", () => {
    // ⚠️ `codigo`, E NÃO `sql`. O comentário do seed CITA as duas empresas para
    // explicar por que elas não estão lá — lendo o texto cru, a explicação
    // derrubaria o teste que ela existe para justificar.
    expect(codigo).not.toMatch(/\bDNA\b/i);
    expect(codigo).not.toMatch(/\bAlivira\b/i);
  });

  it("a escala tem os cinco níveis com valor numérico (§5)", () => {
    expect(codigo).toContain("'label', 'Excelente', 'value', 5");
    expect(codigo).toContain("'label', 'Bom', 'value', 4");
    expect(codigo).toContain("'label', 'Regular', 'value', 3");
    expect(codigo).toContain("'label', 'Ruim', 'value', 2");
    expect(codigo).toContain("'label', 'Péssimo', 'value', 1");
  });

  /**
   * ⚠️ O SEED É IDEMPOTENTE. Sem isto, reaplicar a migration criaria um segundo
   * "modelo padrão" — e o índice parcial `where is_default` recusaria a
   * migration inteira.
   */
  it("o seed não roda duas vezes", () => {
    expect(codigo).toMatch(
      /if exists \(select 1 from public\.event_evaluations where is_default\) then\s*return;/,
    );
  });

  it("o comentário é de texto livre e NÃO é obrigatório", () => {
    expect(codigo).toMatch(/'free_text', false\s*\);/);
  });
});

/* ========================================================================== */
/* §35, §36 — permissão e trilha                                              */
/* ========================================================================== */

describe("§35 — as duas camadas de permissão contam a mesma história", () => {
  /**
   * ⚠️ `SECURITY DEFINER` DESLIGA A RLS. Sem a checagem dentro do corpo, cada
   * função seria a porta destrancada dos fundos — e elas PRECISAM ser DEFINER,
   * porque gravam na trilha, que é fechada.
   */
  it("toda função de escrita chamável por `authenticated` confere a permissão por dentro", () => {
    const escritas: Array<[string, string]> = [
      ["save_event_evaluation_settings", "evaluations_is_writer"],
      ["save_event_evaluation_structure", "evaluations_is_writer"],
      ["apply_evaluation_template", "evaluations_is_writer"],
      ["resend_event_evaluation", "evaluations_is_sender"],
      ["cancel_event_evaluation", "evaluations_is_sender"],
      ["reopen_event_evaluation", "evaluations_is_writer"],
    ];

    for (const [fn, guarda] of escritas) {
      const corpo = corpoDe(fn);
      expect(corpo, `${fn} não é SECURITY DEFINER`).toContain("security definer");
      expect(corpo, `${fn} não confere ${guarda}`).toContain(`public.${guarda}()`);
      expect(corpo, `${fn} não recusa com 42501`).toContain("errcode = '42501'");
    }
  });

  it("os papéis do banco batem com a PERMISSION_MATRIX", () => {
    const leitor = corpoDe("evaluations_is_reader");
    const escritor = corpoDe("evaluations_is_writer");
    const remetente = corpoDe("evaluations_is_sender");

    for (const papel of PERMISSION_MATRIX["evaluations.read"]) {
      expect(leitor, `evaluations_is_reader não inclui ${papel}`).toContain(`'${papel}'`);
    }
    for (const papel of PERMISSION_MATRIX["evaluations.write"]) {
      expect(escritor, `evaluations_is_writer não inclui ${papel}`).toContain(`'${papel}'`);
    }
    for (const papel of PERMISSION_MATRIX["evaluations.send"]) {
      expect(remetente, `evaluations_is_sender não inclui ${papel}`).toContain(`'${papel}'`);
    }

    // A direção oposta: o Atendente NÃO escreve.
    expect(PERMISSION_MATRIX["evaluations.write"]).not.toContain("comercial");
    expect(escritor).not.toContain("'comercial'");
  });

  /**
   * ⚠️ SÓ O TETO NÃO BASTA. Uma permissão acrescentada depois entra em
   * `app_role_ceilings` e não entra em cargo nenhum — e o resultado seria o item
   * "Avaliações" invisível até para o Administrador, com a RLS liberada.
   */
  it("as três permissões são semeadas no teto E nos cargos embutidos", () => {
    for (const chave of ["evaluations.read", "evaluations.write", "evaluations.send"]) {
      expect(codigo, `${chave} não está no teto`).toContain(`'${chave}'`);
    }
    expect(codigo).toContain("insert into public.app_role_permissions (role_key, permission)");
    expect(codigo).toContain("where r.is_builtin");
  });

  it("as funções do worker NÃO são executáveis por quem usa o sistema", () => {
    for (const fn of [
      "schedule_event_evaluations(integer)",
      "expire_event_evaluations()",
      "claim_event_evaluations(integer)",
      "mark_event_evaluation_sent(uuid, text)",
      "mark_event_evaluation_failed(uuid, text)",
    ]) {
      expect(codigo, `${fn} continua alcançável por authenticated`).toMatch(
        new RegExp(
          `revoke execute on function\\s+public\\.${fn.replace(/[().]/g, "\\$&")}[\\s\\S]{0,80}authenticated`,
        ),
      );
    }
  });

  /**
   * ⚠️ AS DUAS PORTAS PÚBLICAS SÃO LIBERADAS SÓ PARA `service_role`, E NÃO PARA
   * `anon`. É o que mantém a superfície pública do banco em zero função: não há
   * como apontar um cliente PostgREST para o projeto e varrer tokens.
   */
  it("as funções públicas não são alcançáveis por `anon`", () => {
    for (const fn of [
      "get_public_event_evaluation(text)",
      "submit_event_evaluation(text, jsonb)",
    ]) {
      const escapada = fn.replace(/[().,\s]/g, (c) => `\\${c}`).replace(/\\ /g, "\\s*");
      expect(codigo).toMatch(
        new RegExp(
          `revoke execute on function[\\s\\S]{0,40}public\\.${escapada}[\\s\\S]{0,80}anon`,
        ),
      );
      expect(codigo).toMatch(
        new RegExp(`grant execute on function public\\.${escapada} to service_role`),
      );
    }
  });

  it("as tabelas são fechadas para escrita direta (decisão 6)", () => {
    for (const tabela of [
      "event_evaluations",
      "event_evaluation_versions",
      "event_evaluation_sections",
      "event_evaluation_questions",
      "event_evaluation_options",
      "event_evaluation_settings",
      "event_participant_evaluations",
      "event_evaluation_answers",
      "event_evaluation_audit_logs",
    ]) {
      expect(codigo, `${tabela} aceita escrita direta`).toContain(
        `revoke insert, update, delete on public.${tabela} from authenticated, anon`,
      );
      expect(codigo, `${tabela} está sem RLS`).toContain(
        `alter table public.${tabela} enable row level security`,
      );
    }
  });

  /**
   * ⚠️ A FORMA `revoke insert, update, delete` É DELIBERADA. Um
   * `revoke update on public.<t> from ...` sozinho marcaria a tabela como
   * "fechada por coluna" para `sql-column-grants.test.ts`, que então exigiria um
   * `grant update (col, ...)` para cada coluna nova.
   */
  it("nenhuma tabela do módulo entra no regime de grant por coluna", () => {
    expect(codigo).not.toMatch(/revoke\s+update\s+on\s+public\.event_evaluation/);
    expect(codigo).not.toMatch(/revoke\s+update\s+on\s+public\.event_participant_evaluations/);
  });
});

describe("§36 — a trilha", () => {
  it("guarda as ações que o escopo pede", () => {
    for (const acao of [
      "evaluation_created",
      "settings_changed",
      "structure_changed",
      "version_published",
      "invitation_sent",
      "invitation_failed",
      "invitation_resent",
      "invitation_cancelled",
      "evaluation_answered",
      "evaluation_reopened",
    ]) {
      expect(codigoEnums, `falta a ação ${acao}`).toContain(`'${acao}'`);
    }
  });

  /**
   * ⚠️ NUNCA DADO PESSOAL NA TRILHA (§33). Nome, e-mail e telefone ficam nas
   * tabelas, sob RLS. O que entra são ids e contagens — o bastante para
   * responder "o que mudou", sem duplicar dado pessoal numa tabela que ninguém
   * pensa em varrer quando alguém pede exclusão.
   */
  it("nenhuma escrita na trilha carrega nome, e-mail ou telefone", () => {
    const trilha = codigo.match(/insert into public\.event_evaluation_audit_logs[\s\S]*?;/g) ?? [];
    for (const bloco of trilha) {
      for (const proibido of ["full_name", "email", "whatsapp", "phone"]) {
        expect(bloco, `a trilha está guardando ${proibido}`).not.toContain(proibido);
      }
    }
  });

  it("a trilha só aceita INSERT — não há update nem delete nela", () => {
    expect(codigo).not.toMatch(/update public\.event_evaluation_audit_logs/);
    expect(codigo).not.toMatch(/delete from public\.event_evaluation_audit_logs/);
  });

  it("quem responde não tem ator — a rotina e o participante não têm sessão", () => {
    expect(corpoDe("submit_event_evaluation")).toMatch(/'evaluation_answered',[\s\S]{0,300}null,/);
  });
});

/* ========================================================================== */
/* §22 — a leitura respeita a RLS                                             */
/* ========================================================================== */

describe("§22 — as leituras", () => {
  /**
   * ⚠️ AS TRÊS CONSULTAS SÃO INVOKER DE PROPÓSITO. Quem não passa em
   * `evaluations_is_reader()` recebe zero linhas mesmo que a checagem de
   * permissão da aplicação falhe. DEFINER aqui seria trocar a segunda barreira
   * por nada.
   */
  it("as consultas da tela NÃO são SECURITY DEFINER", () => {
    for (const fn of [
      "event_evaluation_summaries",
      "event_evaluation_detail",
      "event_evaluation_participants",
    ]) {
      expect(corpoDe(fn), `${fn} virou DEFINER`).not.toContain("security definer");
    }
  });

  it("métricas e linhas saem da mesma consulta", () => {
    const corpo = corpoDe("event_evaluation_participants");
    expect(corpo).toMatch(/with base as \(/);
    expect(corpo).toMatch(/'metrics', jsonb_build_object/);
    expect(corpo).toMatch(/from base/);
  });

  it("a lista de andamento só traz presentes (§11)", () => {
    expect(corpoDe("event_evaluation_participants")).toContain("and p.present");
  });

  it("a grid de eventos só traz eventos com participante", () => {
    expect(corpoDe("event_evaluation_summaries")).toMatch(
      /exists \(select 1 from public\.event_participants p where p\.event_id = e\.id\)/,
    );
  });
});

/* ========================================================================== */
/* A migration é reversível e não é destrutiva                                */
/* ========================================================================== */

describe("a migration", () => {
  it("tem bloco de ROLLBACK", () => {
    expect(sql).toContain("-- ROLLBACK");
    expect(sqlEnums).toContain("-- ROLLBACK");
  });

  /**
   * ⚠️ NÃO FAZ NADA DESTRUTIVO. Ela só ACRESCENTA: nove tabelas novas, um índice
   * único em `event_participants` (que a FK composta exige) e três permissões.
   * Nenhuma coluna existente é alterada, nenhuma linha é reescrita.
   */
  it("não apaga nem reescreve nada que já existia", () => {
    expect(codigo).not.toMatch(/drop table/);
    expect(codigo).not.toMatch(/drop column/);
    expect(codigo).not.toMatch(/truncate/);
    expect(codigo).not.toMatch(/update public\.event_participants/);
    expect(codigo).not.toMatch(/update public\.events\b/);
  });

  it("o índice composto que a FK exige é criado antes da tabela que o usa", () => {
    const indice = codigo.indexOf("event_participants_id_event_idx");
    const fk = codigo.indexOf("event_participant_evaluations_participant_matches_event");
    expect(indice).toBeGreaterThan(-1);
    expect(fk).toBeGreaterThan(indice);
  });

  it("tudo é `if not exists` — reaplicar não quebra", () => {
    const criacoes = codigo.match(/create table (if not exists )?public\.event_evaluation/g) ?? [];
    for (const linha of criacoes) {
      expect(linha, `${linha} não é idempotente`).toContain("if not exists");
    }
  });
});
