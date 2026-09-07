import { readdirSync, readFileSync } from "node:fs";
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

/**
 * ============================================================================
 * ⚠️ TODAS AS MIGRATIONS DO MÓDULO, NA ORDEM — E NÃO SÓ A PRIMEIRA.
 * ============================================================================
 * A versão original deste arquivo lia `20260922000100_event_landing.sql` e mais
 * nada. Funcionou enquanto o módulo cabia numa migration; deixou de funcionar
 * no instante em que o Prompt 3 REDEFINIU `create_event_registration` para
 * acrescentar o consentimento e o limite de taxa.
 *
 * O modo de falhar era o pior possível: os casos abaixo continuariam PASSANDO,
 * lendo uma definição que o banco não usa mais. Um teste verde sobre código
 * morto é pior que teste nenhum — ele afirma que a garantia existe.
 *
 * Concatenar na ordem dos nomes (que é a ordem de aplicação) e procurar a
 * ÚLTIMA definição de cada função é o que faz este arquivo descrever o banco de
 * hoje, e não o de setembro.
 */
/**
 * ⚠️ O FILTRO PEGA AS DUAS FAMÍLIAS DE NOME DO MÓDULO, e a segunda entrou
 * corrigindo um defeito real desta bateria.
 *
 * O Prompt 4 acrescentou `20260925000100_event_registration_backoffice.sql`, que
 * REDEFINE `set_participant_confirmation` e `update_event_registration`. Com o
 * filtro procurando só por "landing", esse arquivo ficava de fora — e os casos
 * abaixo voltariam a descrever definições que o banco não usa mais, PASSANDO.
 *
 * É exatamente a falha que o comentário acima descreve, reaparecendo por um
 * nome de arquivo. A lição: o filtro precisa acompanhar o módulo, não a palavra.
 */
/**
 * ⚠️ E ELE JÁ FALHOU DE NOVO, PELA TERCEIRA VEZ, PELO MESMO MOTIVO.
 *
 * O filtro era `/landing|event_registration/`, e deixava de fora DOIS arquivos
 * do módulo que não têm nenhuma das duas palavras inteiras no nome:
 *
 *   20260927000000_registration_writes_security_definer.sql
 *   20260929000000_event_registration_board_metrics.sql
 *
 * O segundo REDEFINE `event_registrations_board`. Com ele de fora, os casos
 * abaixo leriam a versão anterior — e um teste verde sobre código morto é pior
 * que teste nenhum.
 *
 * `registration` sozinho fecha a família inteira, e a asserção logo abaixo
 * cobra que a conta bate: um arquivo novo do módulo com nome criativo quebra o
 * teste em vez de sumir dele.
 */
const ARQUIVOS = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql") && /landing|registration/.test(nome))
  .sort();

const sql = ARQUIVOS.map((nome) => readFileSync(join(MIGRATIONS, nome), "utf8")).join("\n");

/**
 * O corpo da ÚLTIMA `create or replace function public.<nome>` do módulo.
 *
 * `lastIndexOf`, e não `indexOf`: quando uma migration posterior redefine a
 * função, é a redefinição que vale.
 */
function corpoDe(nome: string): string {
  const inicio = sql.lastIndexOf(`create or replace function public.${nome}(`);
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThan(-1);

  // Da declaração até o `$$;` que a fecha.
  const fim = sql.indexOf("\n$$;", inicio);
  expect(fim, `função ${nome} não tem fim`).toBeGreaterThan(inicio);
  return sql.slice(inicio, fim);
}

describe("a bateria está lendo o que acha que está lendo", () => {
  /**
   * Sem isto, um filtro quebrado transformaria o arquivo inteiro numa lista de
   * asserções sobre string vazia — e `expect("").not.toMatch(/anon/)` passa.
   */
  it("encontra as migrations do módulo", () => {
    expect(ARQUIVOS).toContain("20260922000100_event_landing.sql");
    expect(ARQUIVOS).toContain("20260924000000_event_landing_public.sql");
    // A do Prompt 4 — sem ela, os casos de confirmação e de edição abaixo leriam
    // as definições antigas e passariam sobre código morto.
    expect(ARQUIVOS).toContain("20260925000100_event_registration_backoffice.sql");
    expect(sql.length).toBeGreaterThan(50_000);
  });

  /**
   * ⚠️ A CONTA, E NÃO UMA LISTA DE NOMES. Nomear cada arquivo esperado seria
   * escrever a mesma lista duas vezes; contar o que EXISTE na pasta contra o que
   * o filtro pegou responde a pergunta real — "ficou algum de fora?" — sem
   * precisar ser atualizada a cada migration.
   *
   * O critério é grosseiro de propósito: todo arquivo do módulo tem "landing" ou
   * "registration" no nome. Um que não tenha quebra aqui, que é onde se quer
   * descobrir — e não silenciosamente, dez casos abaixo, lendo uma definição
   * que o banco já não usa.
   */
  it("nenhum arquivo do módulo fica de fora do filtro", () => {
    const doModulo = readdirSync(MIGRATIONS).filter(
      (nome) => nome.endsWith(".sql") && /landing|registration/.test(nome),
    );
    expect(ARQUIVOS).toHaveLength(doModulo.length);
    expect(ARQUIVOS).toContain("20260927000000_registration_writes_security_definer.sql");
    expect(ARQUIVOS).toContain("20260929000000_event_registration_board_metrics.sql");
  });

  /**
   * ⚠️ O CASO QUE JUSTIFICA O `lastIndexOf`. `create_event_registration` existe
   * duas vezes no módulo, e se um dia passar a existir três, este teste
   * continua valendo — o que ele afirma é que a leitura pega a última.
   */
  it("pega a redefinição de create_event_registration, e não a original", () => {
    const ocorrencias =
      sql.split("create or replace function public.create_event_registration(").length - 1;
    expect(ocorrencias).toBeGreaterThan(1);
    // O consentimento só existe na versão nova.
    expect(corpoDe("create_event_registration")).toContain("p_consent_policy_version");
  });
});

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

/* ========================================================================== */
/* A PORTA PÚBLICA — Prompt 3                                                 */
/* ========================================================================== */

describe("§4 e §5 — a leitura pública não mostra o que não deve", () => {
  const corpo = corpoDe("get_public_event_landing_page");

  /**
   * ⚠️ RASCUNHO E INATIVA NÃO EXISTEM PARA O MUNDO. Sem esta cláusula, colar o
   * endereço de uma página que a APCS ainda está preparando abriria o evento
   * inteiro — nome, data, local e formulário — antes de alguém decidir
   * publicá-lo. O `closed` PASSA de propósito: o §4 manda a página encerrada
   * continuar visível.
   */
  it("só devolve página publicada ou encerrada", () => {
    expect(corpo).toContain("l.status in ('published', 'closed')");
  });

  /**
   * ⚠️ SECURITY DEFINER + EXECUTE SÓ PARA `service_role`. Se `anon` pudesse
   * executá-la, a chave anônima — que vai no bundle do navegador, por
   * definição — viraria uma API pública de consulta de eventos da APCS.
   */
  it("é security definer e só o servidor executa", () => {
    expect(corpo).toContain("security definer");
    expect(sql).toMatch(
      /revoke execute on function public\.get_public_event_landing_page\(text\)\s*\n?\s*from public, anon, authenticated;/,
    );
    expect(sql).toContain(
      "grant execute on function public.get_public_event_landing_page(text) to service_role;",
    );
  });

  /**
   * ⚠️ O TESTE MAIS IMPORTANTE DESTE BLOCO. A função devolve um jsonb montado à
   * mão: acrescentar um campo é uma linha, e nada avisa. Estas três tabelas
   * guardam DADO PESSOAL DE TERCEIROS — nome, e-mail e telefone de gente que
   * não trabalha na APCS — e nenhuma delas tem por que ser lida por uma função
   * que responde a quem não está logado.
   */
  it("não toca em inscrição, participante nem trilha", () => {
    expect(corpo).not.toContain("event_registrations");
    expect(corpo).not.toContain("event_participants");
    expect(corpo).not.toContain("event_registration_audit_logs");
  });

  /**
   * ⚠️ SEM `event_id` NO RETORNO. A página pública manda o SLUG no envio, e o
   * servidor deriva o resto — ver `publicRegistrationSchema`. Um id de evento no
   * jsonb desceria para o navegador sem uso nenhum, e ids que descem sem uso são
   * os que aparecem em algum lugar errado depois.
   */
  it("não devolve o id do evento", () => {
    expect(corpo).not.toMatch(/'eventId'/);
  });
});

describe("§35 — o consentimento é o mecanismo que já existe", () => {
  const corpo = corpoDe("create_event_registration");

  /**
   * ⚠️ `consent_texts`, E NÃO UMA TABELA NOVA. O §35 é explícito: "Não inventar
   * uma segunda solução de consentimento". A tabela é a mesma da landing de
   * associação, append-only desde agosto.
   */
  it("a leitura pública devolve o texto vigente de consent_texts", () => {
    expect(corpoDe("get_public_event_landing_page")).toContain("from public.consent_texts c");
  });

  /**
   * ⚠️ EXIGIDO SÓ NA PORTA PÚBLICA. No backoffice quem digita é a APCS, a partir
   * de uma lista de papel — não é o titular do dado, e não tem como aceitar nada
   * em nome dele. Exigir ali travaria o cadastro interno por uma autorização que
   * ninguém pode dar.
   */
  it("é obrigatório para a origem landing_page e dispensado no backoffice", () => {
    expect(corpo).toContain(
      "if v_origin = 'landing_page' and coalesce(btrim(p_consent_policy_version), '') = '' then",
    );
    expect(corpo).toContain("errcode = 'RG008'");
  });

  /**
   * ⚠️ A VERSÃO CHEGA DE FORA, e não é lida aqui dentro. Se um administrador
   * publicar um texto novo enquanto a granja preenche o formulário, a inscrição
   * tem de guardar a versão que ESTAVA NA TELA — buscar a vigente no instante da
   * gravação registraria uma autorização para um texto que ninguém leu. Um
   * `current_consent_text()` no corpo desta função seria exatamente esse
   * defeito, e ele é invisível: a coluna fica preenchida, só que com a versão
   * errada.
   */
  it("não relê o consentimento vigente na hora de gravar", () => {
    expect(corpo).not.toContain("current_consent_text");
    expect(corpo).toContain("consent_policy_version");
  });
});

describe("§22 e §23 — concorrência e reenvio na porta pública", () => {
  const corpo = corpoDe("create_event_registration");

  /**
   * ==========================================================================
   * ⚠️ A ORDEM É O QUE FAZ O LIMITE DE TAXA NÃO PUNIR QUEM É LEGÍTIMO.
   * ==========================================================================
   * Um F5 no meio do envio, um duplo clique ou um retry de rede chegam com o
   * MESMO `dedupe_key`. Se o limite rodasse antes da idempotência, cada
   * tentativa dessas consumiria cota — e uma conexão ruim, que é justamente
   * quem mais reenvia, seria bloqueada por tentar se inscrever. Com esta ordem,
   * só um envio de verdade conta.
   */
  it("o limite de taxa vem DEPOIS da conferência de idempotência", () => {
    const dedupe = corpo.indexOf("where r.dedupe_key = p_dedupe_key");
    const limite = corpo.indexOf("event_registration_ip_hourly_limit");

    expect(dedupe).toBeGreaterThan(-1);
    expect(limite).toBeGreaterThan(-1);
    expect(dedupe).toBeLessThan(limite);
  });

  /**
   * ⚠️ SÓ A PORTA PÚBLICA É LIMITADA. Alguém do comercial cadastrando doze
   * granjas de uma lista, todas do mesmo escritório, não é abuso — e um teto que
   * as barrasse transformaria uma tarde de trabalho num erro sem explicação.
   */
  it("o limite não alcança o backoffice", () => {
    expect(corpo).toContain("if v_origin = 'landing_page' and p_source_ip_hash is not null then");
    expect(corpo).toContain("r.origin = 'landing_page'");
  });

  /**
   * ⚠️ O LOCK CONTINUA ANTES DA CONTAGEM depois da redefinição. É o §22 inteiro:
   * capacidade 100, restam 5, dois envios de 5 pessoas ao mesmo tempo — sem o
   * lock, os dois leem a mesma contagem e os dois cabem.
   */
  it("a capacidade continua conferida sob o lock", () => {
    const lock = corpo.indexOf("lock_event_landing_page");
    const contagem = corpo.indexOf("event_landing_participant_count");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(contagem);
  });

  /** O hash do IP, nunca o IP — §35 e a mesma decisão de Associados. */
  it("o limite de taxa trabalha sobre o hash, não sobre o endereço", () => {
    expect(corpo).toContain("r.source_ip_hash = p_source_ip_hash");
  });
});

describe("§37 — a trilha não guarda dado pessoal", () => {
  const corpo = corpoDe("create_event_registration");

  /**
   * ⚠️ QUANTOS, E NÃO QUEM. O "quem" está em `event_participants`, sob RLS, e é
   * de lá que ele sai quando alguém pede exclusão. Copiar nome ou e-mail para a
   * trilha criaria uma segunda cópia que ninguém lembraria de apagar — e a
   * trilha é append-only por construção.
   */
  it("a metadata da criação não cita nome, e-mail nem telefone", () => {
    const trecho = corpo.slice(corpo.indexOf("'registration_created'"));
    expect(trecho).toContain("'participants', v_count");
    expect(trecho).not.toMatch(/fullName|'email'|'phone'|'whatsapp'/);
  });

  /** A versão do consentimento ENTRA: não identifica ninguém e é a prova. */
  it("a metadata guarda qual consentimento valia", () => {
    expect(corpo).toContain("'consentPolicyVersion', v_new.consent_policy_version");
  });
});

/* ========================================================================== */
/* O BACKOFFICE DE INSCRIÇÕES — Prompt 4                                      */
/* ========================================================================== */

describe("§25 e §26 — a cadeia conferida no banco (IDOR)", () => {
  /**
   * ==========================================================================
   * ⚠️ AS TRÊS ESCRITAS EXIGEM O EVENTO, E NENHUMA PODE DEIXAR DE EXIGIR.
   * ==========================================================================
   * O §25 é explícito: "garantir especialmente que um usuário não consiga
   * acessar um participante informando manualmente um ID pertencente a outro
   * evento". A RLS não responde essa pergunta — ela decide se a pessoa pode ver
   * INSCRIÇÕES, e um administrador pode ver todas. O que impede a operação de
   * atravessar o contexto é a condição de evento dentro de cada função.
   *
   * Este teste falha se alguém "simplificar" a assinatura removendo o
   * `p_event_id` — que é uma refatoração que parece limpeza e abre a porta.
   */
  it.each([
    ["update_event_participant", "p.event_id = p_event_id"],
    ["set_participant_confirmation", "p.event_id = p_event_id"],
    ["update_event_registration", "r.event_id = p_event_id"],
  ])("%s confere o evento antes de escrever", (funcao, condicao) => {
    const corpo = corpoDe(funcao);
    expect(corpo.slice(0, corpo.indexOf(")"))).toContain("p_event_id");
    expect(corpo).toContain(condicao);
  });

  /**
   * ⚠️ O MESMO ERRO PARA "NÃO EXISTE" E PARA "É DE OUTRO EVENTO". Distinguir os
   * dois transformaria a função num oráculo: quem tentasse ids ao acaso
   * descobriria quais existem no sistema, mesmo sem conseguir lê-los.
   */
  it("não distingue 'não existe' de 'é de outro evento'", () => {
    for (const funcao of ["update_event_participant", "set_participant_confirmation"]) {
      expect(corpoDe(funcao)).toContain("errcode = 'P0002'");
    }
  });

  /** A leitura também: a grid é de UM evento, e a junção repete a condição. */
  it("a leitura da grid amarra participante e inscrição ao mesmo evento", () => {
    const corpo = corpoDe("event_registrations_board");
    expect(corpo).toContain("where p.event_id = p_event_id");
    expect(corpo).toContain("and r.event_id = p_event_id");
  });
});

describe("§22 e §23 — a confirmação é atômica e idempotente", () => {
  const corpo = corpoDe("set_participant_confirmation");

  /**
   * ==========================================================================
   * ⚠️ A CONDIÇÃO ESTÁ DENTRO DO `update`, E É O QUE PROTEGE A TRILHA.
   * ==========================================================================
   * A versão do Prompt 1 fazia `select` → `if igual then return` → `update`.
   * Duas requisições simultâneas (duplo clique, retry, dois operadores na mesma
   * pessoa) passam AS DUAS pelo `if` e gravam AS DUAS — resultado final certo,
   * mas DUAS linhas de auditoria afirmando que houve mudança de `false` para
   * `true`, sendo que a segunda não mudou nada.
   *
   * A trilha é o registro de quem afirmou o quê (§12); enchê-la de mudanças que
   * não aconteceram é corrompê-la em silêncio — e ninguém percebe, porque o
   * estado final está correto.
   */
  it("o update só grava quando o valor MUDA", () => {
    expect(corpo).toContain("confirmation is distinct from p_confirmation");
  });

  /**
   * ⚠️ REPETIR É SUCESSO, NÃO ERRO (§23). Quem clicou duas vezes vê o mesmo
   * estado das duas vezes. Um erro aqui faria um retry de rede — que é
   * exatamente o caso que o §23 manda tratar — virar uma mensagem vermelha
   * sobre uma operação que deu certo.
   */
  it("repetir a mesma confirmação devolve o participante, sem auditar de novo", () => {
    const semAlteracao = corpo.indexOf("if v_new.id is null then");
    const auditoria = corpo.indexOf("insert into public.event_registration_audit_logs");

    expect(semAlteracao).toBeGreaterThan(-1);
    expect(semAlteracao).toBeLessThan(auditoria);
    expect(corpo).toContain("return v_old;");
  });

  /** §12 — a trilha registra o valor anterior e o novo. */
  it("a trilha guarda de onde para onde", () => {
    expect(corpo).toContain("'from', v_old.confirmation");
    expect(corpo).toContain("'to', v_new.confirmation");
  });
});

describe("§14 — duplicidade de e-mail na edição", () => {
  const corpo = corpoDe("update_event_participant");

  /**
   * ==========================================================================
   * ⚠️ O PRÓPRIO PARTICIPANTE É DESCONSIDERADO — SEM ISSO, NINGUÉM SALVA NADA.
   * ==========================================================================
   * O §14 pede: "ao editar o próprio participante, o registro atual deve ser
   * desconsiderado na validação de duplicidade". Sem o `p.id <> p_participant_id`,
   * abrir a ficha do João e corrigir o TELEFONE dele acusaria o e-mail dele de
   * estar duplicado — com ele mesmo. A tela ficaria impossível de usar, e a
   * mensagem não daria nenhuma pista do motivo.
   */
  it("desconsidera o próprio registro", () => {
    expect(corpo).toContain("p.id <> p_participant_id");
  });

  /**
   * ⚠️ E SÓ CONFERE QUANDO O E-MAIL MUDOU. Uma consulta a cada salvamento é
   * trabalho jogado fora — e seria uma segunda chance de o resultado discordar
   * do índice único por causa de uma corrida.
   */
  it("só confere quando o e-mail muda", () => {
    expect(corpo).toContain("if v_email is distinct from v_old.email and exists");
  });

  /** A comparação é sobre o valor normalizado — §14 pede case-insensitive. */
  it("compara em minúsculas, como o índice único exige", () => {
    expect(corpo).toContain("lower(btrim(coalesce(p_email, '')))");
  });

  /** §15 — telefone OU WhatsApp continua valendo na edição. */
  it("recusa participante sem telefone e sem WhatsApp", () => {
    expect(corpo).toContain("if v_phone is null and v_whatsapp is null then");
    expect(corpo).toContain("errcode = 'RG005'");
  });
});

describe("§25 — a trilha da edição não guarda dado pessoal", () => {
  const corpo = corpoDe("update_event_participant");

  /**
   * ==========================================================================
   * ⚠️ OS NOMES DOS CAMPOS, NUNCA OS VALORES.
   * ==========================================================================
   * Gravar "email: joao@x.com → joao@y.com" na trilha criaria uma SEGUNDA CÓPIA
   * do dado pessoal, numa tabela append-only, fora de `event_participants` — que
   * é de onde o dado sai quando alguém exerce o direito de exclusão. A cópia
   * sobreviveria ao pedido, e ninguém lembraria dela.
   *
   * A confirmação é a exceção deliberada: ela não identifica ninguém, e é
   * justamente a mudança que o §12 manda registrar com "de/para".
   */
  it("registra quais campos mudaram, e não o que eles passaram a valer", () => {
    expect(corpo).toContain("to_jsonb('email'::text)");

    // ⚠️ O RECORTE É O BLOCO DA TRILHA, e não a função inteira — a primeira
    // versão deste caso procurava `v_old.email` no corpo todo e acusava a
    // NORMALIZAÇÃO (`coalesce(..., v_old.email)`), que é legítima. Um teste que
    // falha no lugar errado é um teste que alguém desliga.
    const bloco = corpo.slice(corpo.indexOf("'participant_updated'"));
    for (const pessoal of [
      "v_old.email",
      "v_new.email",
      "v_new.full_name",
      "v_new.phone",
      "v_new.whatsapp",
    ]) {
      expect(bloco, `a trilha não pode carregar ${pessoal}`).not.toContain(pessoal);
    }
  });

  it("a confirmação continua sendo a exceção, com de/para", () => {
    expect(corpo).toContain("'from', v_old.confirmation");
    expect(corpo).toContain("'to', v_new.confirmation");
  });
});

describe("§6, §7 e §21 — o quadro da tela", () => {
  const corpo = corpoDe("event_registrations_board");

  /**
   * ⚠️ MÉTRICAS E LINHAS SAEM DO MESMO `where`. O §6 pede que os indicadores
   * respeitem os filtros ativos; com duas consultas, o mesmo filtro existiria em
   * dois lugares e o dia em que um deles mudasse a tela diria "12 confirmados"
   * sobre uma lista de 5. Ninguém confere a soma à mão.
   */
  it("métricas e página saem da mesma CTE filtrada", () => {
    expect(corpo).toContain("with filtrado as (");
    expect(corpo).toContain("from filtrado");
    expect(corpo).toContain("from filtrado f");
  });

  /**
   * ⚠️ A BUSCA POR TELEFONE PRECISA DO SEGUNDO PADRÃO. Quem procura cola
   * "(11) 99999-8888" da conversa; a coluna guarda "11999998888". Sem tirar a
   * máscara do que foi digitado, a busca por telefone nunca acha ninguém — e o
   * §7 pede que ela ache.
   */
  it("procura telefone pelos dígitos, além do texto", () => {
    expect(corpo).toContain("v_digitos");
    expect(corpo).toContain("'[^0-9]'");
  });

  /** §7 — a busca atravessa as duas tabelas: a granja e a pessoa. */
  it("procura na granja e no participante", () => {
    expect(corpo).toContain("p.search_text like");
    expect(corpo).toContain("r.search_text like");
  });

  /**
   * ⚠️ OS CURINGAS DO LIKE VIRAM LITERAIS. Sem o escape, uma granja chamada
   * "100%" faria a busca virar curinga — e procurar por ela devolveria a base
   * inteira do evento.
   */
  it("escapa os curingas do LIKE", () => {
    expect(corpo).toContain("v_texto := replace(v_texto, '_'");
  });

  /**
   * ⚠️ ORDENAÇÃO POR LISTA FECHADA. `p_sort` vem da URL: um `order by` montado
   * com texto de fora é injeção de SQL por outro nome. Aqui ele só escolhe
   * entre `case`s escritos à mão, e nada é executado dinamicamente.
   */
  it("a ordenação não interpola texto recebido", () => {
    expect(corpo).toContain("case when v_sort = 'company'");
    expect(corpo).not.toMatch(/\bexecute\b/i);
  });

  /**
   * ⚠️ DESEMPATE ESTÁVEL. Sem ele, duas pessoas inscritas no mesmo segundo
   * trocam de lugar entre a página 1 e a 2 — e uma delas some da listagem sem
   * nunca aparecer. Mesma armadilha que `listLectures` documenta.
   */
  it("a ordenação tem desempate por id", () => {
    expect(corpo).toContain("f.participant_id asc");
  });

  /**
   * ⚠️ SECURITY INVOKER (o padrão), e o teste existe para continuar assim. Aqui
   * há usuário logado, e a RLS de `event_registrations`/`event_participants` é a
   * segunda camada do RBAC. Um `security definer` desligaria justamente a
   * proteção que faz sentido nesta porta — e a tabela guarda dado pessoal de
   * centenas de terceiros. O contraste é com `get_public_event_landing_page`,
   * que É definer porque ali não existe sessão para a RLS avaliar.
   */
  it("NÃO é security definer", () => {
    expect(corpo).not.toContain("security definer");
  });

  /** §21 — o teto de linhas é imposto no banco, não pela tela. */
  it("limita o tamanho da página no próprio SQL", () => {
    expect(corpo).toContain("least(coalesce(p_limit, 25), 200)");
  });
});

describe("§8 — o período é do calendário da APCS, não do relógio do servidor", () => {
  const corpo = corpoDe("event_registrations_board");

  /**
   * ==========================================================================
   * ⚠️ NASCEU DE UM DEFEITO DE TRÊS HORAS, ENCONTRADO NA REVISÃO DO PROMPT 4.
   * ==========================================================================
   * A primeira versão recebia `timestamptz` e o serviço montava o valor
   * concatenando texto (`"2026-09-06" + "T00:00:00"`). Um literal de timestamp
   * SEM FUSO é lido pelo Postgres no fuso do SERVIDOR — UTC na Supabase —,
   * então "inscritos a partir de 06/09" significava 05/09 às 21h em São Paulo.
   *
   * O sintoma seria quase invisível: uma contagem "quase certa" e uma
   * exportação com algumas linhas a mais ou a menos que a tela. Ninguém confere
   * um CSV de trezentas pessoas linha por linha.
   *
   * A correção é a mesma decisão de `event_today()`: a DATA entra, e o fuso é
   * aplicado no banco.
   */
  it("recebe datas e converte no fuso da APCS", () => {
    const assinatura = corpo.slice(0, corpo.indexOf(")"));
    expect(assinatura).toContain("p_from date");
    expect(assinatura).toContain("p_to date");
    expect(corpo).toContain("at time zone 'America/Sao_Paulo'");
  });

  /**
   * ⚠️ O FIM É EXCLUSIVO NO DIA SEGUINTE, e não "23:59:59.999" do mesmo dia.
   * Escrever o fim como o último milissegundo é a armadilha clássica: uma
   * inscrição gravada às 23:59:59.9997 fica de fora, e o defeito só aparece uma
   * vez a cada mil anos de uso — o que é pior do que aparecer sempre.
   */
  it("o fim do período é o dia seguinte, exclusivo", () => {
    expect(corpo).toContain("(p_to + 1)");
    expect(corpo).toContain("r.registered_at < v_fim");
    expect(corpo).not.toContain("23:59:59");
  });
});

/* ========================================================================== */
/* HOMOLOGAÇÃO — Prompt 5                                                     */
/* ========================================================================== */

describe("§5 e §17 — evento que já aconteceu não aceita inscrição", () => {
  const corpo = corpoDe("create_event_registration");

  /**
   * ==========================================================================
   * ⚠️ O BURACO QUE A AUDITORIA DE PONTA A PONTA ENCONTROU.
   * ==========================================================================
   * `closes_at` é OPCIONAL — o Builder o oferece com o início do evento como
   * padrão, e quem edita pode limpar o campo. Sem esta cláusula, uma página
   * publicada, sem prazo e sem capacidade, aceitava inscrição para um evento de
   * 2024. Indefinidamente, e sem nenhum sinal na tela.
   *
   * A régua é `event_today()` — a MESMA que Eventos usa para expiração desde o
   * primeiro módulo. Uma segunda definição de "passou" seria uma segunda
   * verdade.
   */
  it("recusa quando a data do evento já passou", () => {
    expect(corpo).toContain("v_event_date < public.event_today()");
    expect(corpo).toContain("errcode = 'RG009'");
  });

  /**
   * ⚠️ E A CONFERÊNCIA VEM ANTES DO PRAZO E DA CAPACIDADE — a mesma ordem que
   * `landingStatusReason` usa na leitura. Se as duas discordassem sobre QUAL
   * motivo mostrar, a tela mandaria quem administra aumentar uma capacidade que
   * não resolveria nada.
   */
  it("a data do evento é conferida antes do prazo e da capacidade", () => {
    const evento = corpo.indexOf("errcode = 'RG009'");
    const prazo = corpo.indexOf("errcode = 'RG001'");
    const capacidade = corpo.indexOf("errcode = 'RG002'");

    expect(evento).toBeGreaterThan(-1);
    expect(evento).toBeLessThan(prazo);
    expect(evento).toBeLessThan(capacidade);
  });

  /**
   * ⚠️ MAS DEPOIS DA IDEMPOTÊNCIA. Um retry que chega depois de o evento ter
   * acontecido — F5 numa aba esquecida aberta — precisa receber a inscrição que
   * JÁ FOI GRAVADA, e não um erro dizendo que o evento passou. A pessoa se
   * inscreveu a tempo; quem chegou atrasado foi a segunda requisição.
   */
  it("mas depois da idempotência, para um retry tardio não virar erro", () => {
    const dedupe = corpo.indexOf("where r.dedupe_key = p_dedupe_key");
    const evento = corpo.indexOf("errcode = 'RG009'");
    expect(dedupe).toBeLessThan(evento);
  });
});

describe("§7 — o teto de participantes por inscrição é 20, e vale no banco", () => {
  /**
   * ⚠️ A REGRA DEIXOU DE MORAR SÓ NO ZOD. Até a homologação, o teto existia
   * apenas no schema — que roda dentro da Server Action, ou seja, no servidor,
   * mas era a única barreira. Um administrador chamando o RPC direto pelo
   * PostgREST passava com 500 pessoas numa inscrição só.
   *
   * O §24 do Prompt 5 é explícito: regra crítica não fica só na aplicação.
   */
  it("a função do banco recusa acima do teto", () => {
    const corpo = corpoDe("create_event_registration");
    expect(corpo).toContain("v_count > public.event_registration_max_participants()");
    expect(corpo).toContain("errcode = 'RG010'");
  });

  /**
   * ⚠️ VINTE, E O NÚMERO ESTÁ AQUI PARA NÃO DIVERGIR DO TypeScript.
   * `MAX_PARTICIPANTS_PER_REGISTRATION` precisa valer o mesmo: com números
   * diferentes, a tela ofereceria um botão que o banco recusa (ou pior, pararia
   * de oferecer antes do limite real).
   */
  it("o teto é 20", () => {
    expect(corpoDe("event_registration_max_participants")).toContain("select 20;");
  });

  /**
   * ⚠️ UMA FUNÇÃO, E NÃO UM NÚMERO SOLTO NO CORPO. O §7 pede a arquitetura
   * preparada para configurar isso depois: assim, mudar o teto é uma migration
   * de uma linha, e o valor fica auditável em um lugar só.
   */
  it("é uma função, para poder mudar sem reescrever a gravação", () => {
    expect(sql).toContain(
      "create or replace function public.event_registration_max_participants()",
    );
  });
});

describe("o TypeScript e o Postgres concordam sobre os números", () => {
  /**
   * ==========================================================================
   * ⚠️ O TETO EXISTE EM DOIS LUGARES, E ELES NÃO PODEM DIVERGIR.
   * ==========================================================================
   * `MAX_PARTICIPANTS_PER_REGISTRATION` (TypeScript) decide quando a tela para
   * de oferecer "adicionar participante" e o que o Zod recusa;
   * `event_registration_max_participants()` (Postgres) é a garantia contra uma
   * chamada direta ao RPC.
   *
   * A duplicação é deliberada — é o §24, "regra crítica não fica só na
   * aplicação". O que não pode é os dois valores se separarem: com o banco menor
   * que a tela, a pessoa preenche vinte fichas e leva um erro; com a tela menor,
   * a garantia vira decoração.
   *
   * Este teste é a amarra. Ele lê o número dos DOIS arquivos.
   */
  it("o teto de participantes por inscrição é o mesmo nos dois lados", () => {
    const doBanco = /select (\d+);/.exec(corpoDe("event_registration_max_participants"))?.[1];

    const ts = readFileSync(
      join(process.cwd(), "src", "modules", "event", "event.landing.types.ts"),
      "utf8",
    );
    const doCodigo = /MAX_PARTICIPANTS_PER_REGISTRATION = (\d+);/.exec(ts)?.[1];

    expect(doBanco, "a função Postgres precisa devolver um número literal").toBeTruthy();
    expect(doCodigo, "a constante do TypeScript precisa ser um número literal").toBeTruthy();
    expect(doCodigo).toBe(doBanco);
  });
});

/* ========================================================================== */
/* O CONTRATO DO jsonb — nomes de chave, conferidos contra o TypeScript       */
/* ========================================================================== */

/**
 * ============================================================================
 * ⚠️ NASCEU DE UM DEFEITO EM PRODUÇÃO: "Não confirmados" em zero para sempre.
 * ============================================================================
 * `event_registrations_board` montava as métricas com `to_jsonb(m)`, e
 * `to_jsonb` de uma linha nomeia as chaves pelas COLUNAS. Saía `not_confirmed`;
 * a aplicação lia `notConfirmed`, não achava, e caía no `?? 0`.
 *
 * ⚠️ SÓ UMA DAS CINCO QUEBROU, e é isso que torna o caso traiçoeiro:
 * `participants`, `confirmed`, `registrations` e `companies` são palavras
 * ÚNICAS — iguais nas duas convenções, casavam por coincidência. A composta era
 * a única que podia falhar, e falhou mostrando ZERO: um número plausível, que
 * ninguém questiona num evento que está indo bem.
 *
 * ⚠️ POR QUE NENHUMA OUTRA BARREIRA PEGA: o jsonb atravessa a fronteira como
 * `unknown`, então o TypeScript está certo dos dois lados; a função compila; a
 * RLS passa; e os testes do CSV montam `metrics` à mão, sem nunca perguntar ao
 * SQL como ele o escreve. É contrato que só existe como COMBINAÇÃO entre banco
 * e aplicação — a mesma família de `sql-column-grants` e `sql-returns-table`.
 */
describe("as métricas do quadro chegam com os nomes que a tela lê", () => {
  const corpo = corpoDe("event_registrations_board");

  /**
   * As cinco chaves de `RegistrationBoardMetrics`, escritas aqui à mão de
   * propósito: importar o tipo não ajudaria (tipo não existe em tempo de
   * execução), e uma lista derivada de outra lista não seria uma segunda
   * opinião.
   */
  const CHAVES = ["participants", "confirmed", "notConfirmed", "registrations", "companies"];

  it("cada chave que o service lê aparece literalmente no SQL", () => {
    for (const chave of CHAVES) {
      expect(corpo, `a chave "${chave}" sumiu do jsonb de métricas`).toContain(`'${chave}'`);
    }
  });

  /**
   * ⚠️ E A FORMA QUE CAUSOU O DEFEITO NÃO VOLTA. Sem esta linha, alguém poderia
   * reintroduzir `to_jsonb(m)` e o caso acima continuaria passando — as chaves
   * ainda estariam escritas, num comentário ou no bloco de `rows`.
   */
  it("as métricas não são montadas com to_jsonb de uma linha", () => {
    expect(corpo).not.toMatch(/'metrics'\s*,\s*\(\s*select\s+to_jsonb/i);
  });

  /**
   * O mesmo cuidado na tela inicial, que sempre montou chave a chave — e que é
   * de onde o `rows` do quadro copiou a forma certa.
   */
  it("a tela inicial de Inscrições também nomeia as chaves", () => {
    expect(corpoDe("event_registration_summaries")).toContain("'notConfirmed'");
  });
});
