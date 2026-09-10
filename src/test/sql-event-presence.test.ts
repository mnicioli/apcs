import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_MATRIX } from "@/lib/rbac/rbac.config";

/**
 * AS INVARIANTES DA LISTA DE PRESENÇA, LIDAS DO TEXTO DAS MIGRATIONS.
 *
 * ============================================================================
 * ⚠️ O QUE ESTE ARQUIVO É, E O QUE ELE HONESTAMENTE NÃO É.
 * ============================================================================
 * Este projeto NÃO sobe Postgres na bateria. Então metade do escopo da presença
 * — o carimbo vir do banco, a reversão limpar o carimbo, a repetição não gerar
 * trilha, o participante de outro evento ser recusado — não pode ser exercitada
 * executando SQL aqui.
 *
 * O que dá para fazer, e é o que a bateria deste projeto já faz em oito outros
 * arquivos, é LER O TEXTO e cobrar a forma. É grosseiro, e é preciso, porque
 * cada caso responde uma pergunta só.
 *
 * ⚠️ E O MOTIVO DE VALER A PENA É O HISTÓRICO. O corpo de uma função PL/pgSQL só
 * é analisado na PRIMEIRA VEZ que cada comando roda: `create function` aceita
 * feliz, o type-check não fala com o Postgres, e os testes de action mockam o
 * Supabase — justamente quem recusaria. Neste módulo isso já custou um defeito
 * em produção (`set_participant_confirmation` nasceu SECURITY INVOKER e não
 * conseguia escrever na trilha; ver 20260927000000). Uma leitura do arquivo é a
 * única barreira que roda a cada commit.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const PRESENCA = "20261001000100_event_registration_presence.sql";
const ENUMS = "20261001000000_event_registration_presence_enums.sql";

const sql = readFileSync(join(MIGRATIONS, PRESENCA), "utf8");
const sqlEnums = readFileSync(join(MIGRATIONS, ENUMS), "utf8");

/**
 * O SQL sem os comentários.
 *
 * ⚠️ SEM ISTO O TESTE MENTE. As migrations deste projeto explicam cada decisão
 * em blocos longos de `--`, e vários deles CITAM comandos. Um regex que enxerga
 * comentário casaria com a prosa e aprovaria um arquivo que não faz nada do que
 * o comentário promete — que é exatamente o defeito de 20260927000000.
 */
function semComentarios(texto: string): string {
  return texto.replace(/--[^\n]*/g, "");
}

const codigo = semComentarios(sql);

/** O corpo da função, da declaração até o `$$;` que a fecha. */
function corpoDe(nome: string): string {
  const inicio = codigo.lastIndexOf(`create or replace function public.${nome}(`);
  expect(inicio, `função ${nome} não encontrada`).toBeGreaterThan(-1);
  const fim = codigo.indexOf("\n$$;", inicio);
  expect(fim, `função ${nome} não tem fim`).toBeGreaterThan(inicio);
  return codigo.slice(inicio, fim);
}

describe("a bateria está lendo o que acha que está lendo", () => {
  it("os dois arquivos da presença existem", () => {
    const naPasta = readdirSync(MIGRATIONS);
    expect(naPasta).toContain(PRESENCA);
    expect(naPasta).toContain(ENUMS);
    expect(codigo.length).toBeGreaterThan(2_000);
  });

  it("os comentários foram removidos antes das asserções", () => {
    // O arquivo TEM prosa; o que é lido pelas asserções, não.
    expect(sql).toContain("-- ");
    expect(codigo).not.toContain("-- ");
  });
});

/* ========================================================================== */
/* §4 e §27 — a coluna nasce desligada, sem quebrar o que existe             */
/* ========================================================================== */

describe("§4 e §27 — o estado inicial e a compatibilidade", () => {
  it("present nasce not null com default false", () => {
    expect(codigo).toMatch(/add column if not exists present boolean not null default false/i);
  });

  it("os dois carimbos nascem nulos", () => {
    // Sem `not null` e sem `default`: nulo é a leitura honesta de "nunca fez
    // check-in", e é o que faz a migration não reescrever linha nenhuma.
    expect(codigo).toMatch(/add column if not exists checked_in_at timestamptz\s*,/i);
    expect(codigo).toMatch(
      /add column if not exists checked_in_by uuid references public\.profiles/i,
    );
    expect(codigo).not.toMatch(/checked_in_at timestamptz[^,;]*not null/i);
  });

  it("a migration não reescreve nem apaga nada", () => {
    // §27: "não realizar nenhuma operação destrutiva". Um `update` ou `delete`
    // em `event_participants` aqui mexeria em inscrição que já existe — e a
    // confirmação de ninguém pode ser tocada por esta migration.
    expect(codigo).not.toMatch(
      /update\s+public\.event_participants\s+set(?![\s\S]{0,400}where id = p_participant_id)/i,
    );
    expect(codigo).not.toMatch(/delete\s+from\s+public\.event_participants/i);
  });

  it("o check-in tem índice dentro do evento", () => {
    expect(codigo).toMatch(
      /create index if not exists event_participants_event_present_idx\s+on public\.event_participants \(event_id, present\)/i,
    );
  });
});

/* ========================================================================== */
/* §13 — o estado impossível não existe                                      */
/* ========================================================================== */

describe("§13 — ausente não pode ter carimbo", () => {
  const constraint =
    /add constraint event_participants_presence_consistency check \(([\s\S]*?)\);/i;

  it("existe um CHECK amarrando presença e carimbo", () => {
    expect(codigo).toMatch(constraint);
  });

  it("presente exige hora, e ausente exige os dois nulos", () => {
    const corpo = constraint.exec(codigo)?.[1] ?? "";
    expect(corpo).toMatch(/present and checked_in_at is not null/i);
    expect(corpo).toMatch(/not present and checked_in_at is null and checked_in_by is null/i);
  });

  it("presente SEM operador continua sendo válido", () => {
    // A assimetria é deliberada e é o §22: um check-in por QR Code não tem
    // pessoa operando. O que não pode existir é ausente com carimbo.
    const corpo = constraint.exec(codigo)?.[1] ?? "";
    expect(corpo).not.toMatch(/present and checked_in_by is not null/i);
  });
});

/* ========================================================================== */
/* §12, §20, §21 — a função de domínio                                       */
/* ========================================================================== */

describe("§12, §20 e §21 — marcar e desmarcar", () => {
  const corpo = corpoDe("set_participant_presence");

  it("é SECURITY DEFINER — ela grava na trilha, que é fechada", () => {
    // `authenticated` não tem insert em `event_registration_audit_logs` e não há
    // policy. Uma versão INVOKER passaria em toda a bateria e falharia com 42501
    // no primeiro clique de uma pessoa de verdade. Já aconteceu neste módulo.
    expect(corpo).toMatch(/security definer/i);
  });

  it("sendo DEFINER, confere a permissão dentro dela", () => {
    // SECURITY DEFINER desliga a RLS. Sem este `raise`, qualquer sessão
    // autenticada marcaria presença de qualquer um.
    expect(corpo).toMatch(/if not public\.presence_is_writer\(\)/i);
    expect(corpo).toMatch(/errcode = '42501'/);
  });

  it("§18 — confere a cadeia antes de qualquer coisa", () => {
    // Sem o `and p.event_id = p_event_id`, um id trocado na requisição marcaria
    // presença em OUTRO evento.
    expect(corpo).toMatch(
      /from public\.event_participants p\s+where p\.id = p_participant_id\s+and p\.event_id = p_event_id/i,
    );
  });

  it("§18 — não distingue 'não existe' de 'é de outro evento'", () => {
    // A diferença entre as duas respostas é um oráculo que confirma a existência
    // de ids alheios.
    const mensagens = [...corpo.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]);
    expect(mensagens).toContain("Participante não encontrado.");
    expect(corpo).not.toMatch(/outro evento/i);
  });

  it("§20 — o UPDATE só grava quando o valor MUDA", () => {
    // Compare-and-set: a condição está DENTRO do update. Dois cliques no mesmo
    // instante não geram duas linhas de trilha.
    expect(corpo).toMatch(
      /where id = p_participant_id\s+and event_id = p_event_id\s+and present is distinct from p_present/i,
    );
  });

  it("§20 — repetir o mesmo valor devolve o participante, sem auditar de novo", () => {
    const semUpdate = corpo.slice(corpo.indexOf("returning * into v_new"));
    expect(semUpdate).toMatch(/if v_new\.id is null then\s+return v_old;\s+end if;/i);
    // A trilha vem DEPOIS desse retorno — ou seja, a repetição não a alcança.
    expect(semUpdate.indexOf("return v_old;")).toBeLessThan(
      semUpdate.indexOf("insert into public.event_registration_audit_logs"),
    );
  });

  it("§21 — o carimbo é now(), e não um parâmetro", () => {
    expect(corpo).toMatch(/checked_in_at = case when p_present then now\(\) else null end/i);
    // ⚠️ A ASSERÇÃO QUE IMPORTA: não existe parâmetro de data na assinatura. Um
    // `p_checked_in_at` seria o relógio do navegador entrando por uma porta que
    // não deveria existir.
    const assinatura = corpo.slice(0, corpo.indexOf(")"));
    expect(assinatura).not.toMatch(/timestamp/i);
  });

  it("§4 — o responsável vem de auth.uid(), e não do payload", () => {
    expect(corpo).toMatch(
      /checked_in_by = case when p_present then \(select auth\.uid\(\)\) else null end/i,
    );
    const assinatura = corpo.slice(0, corpo.indexOf(")"));
    expect(assinatura).not.toMatch(/p_actor|p_user|p_checked_in_by/i);
  });

  it("§13 — desmarcar limpa os dois carimbos", () => {
    expect(corpo).toMatch(/checked_in_at = case when p_present then now\(\) else null end/i);
    expect(corpo).toMatch(
      /checked_in_by = case when p_present then \(select auth\.uid\(\)\) else null end/i,
    );
  });

  it("§3 — não toca em confirmation", () => {
    // A independência dos dois indicadores é imposta pelo desenho, e não pela
    // memória de quem escreve a próxima versão.
    expect(corpo).not.toMatch(/confirmation/i);
  });

  it("§22 — a origem existe e a lista dela é fechada", () => {
    expect(corpo).toMatch(/v_source not in \('backoffice', 'qr_code'\)/i);
    expect(corpo).toMatch(/errcode = '22023'/);
  });

  it("o execute é revogado de anon", () => {
    expect(codigo).toMatch(
      /revoke execute on function public\.set_participant_presence\(uuid, uuid, boolean, text\)\s+from public, anon;/i,
    );
    expect(codigo).toMatch(
      /grant execute on function public\.set_participant_presence\(uuid, uuid, boolean, text\)\s+to authenticated;/i,
    );
  });
});

/* ========================================================================== */
/* §5 — a trilha                                                             */
/* ========================================================================== */

describe("§5 — a auditoria", () => {
  const corpo = corpoDe("set_participant_presence");
  const trilha = corpo.slice(corpo.indexOf("insert into public.event_registration_audit_logs"));

  it("usa o valor próprio do enum, e não o da confirmação", () => {
    expect(trilha).toContain("'participant_presence_changed'");
    expect(trilha).not.toContain("participant_confirmation_changed");
  });

  it("o valor do enum é declarado num arquivo SEPARADO", () => {
    // `alter type ... add value` e o USO do valor novo não podem estar na mesma
    // transação — o Postgres recusa com "unsafe use of new value of enum type".
    expect(sqlEnums).toMatch(
      /alter type public\.event_registration_audit_action\s+add value if not exists 'participant_presence_changed'/i,
    );
    expect(codigo).not.toMatch(/add value if not exists 'participant_presence_changed'/i);
    // E o arquivo do enum ordena ANTES do que o usa.
    expect(ENUMS < PRESENCA).toBe(true);
  });

  it("guarda o de/para, o participante, a origem e o carimbo", () => {
    expect(trilha).toMatch(/'participantId', v_new\.id/);
    expect(trilha).toMatch(/'from', v_old\.present/);
    expect(trilha).toMatch(/'to', v_new\.present/);
    expect(trilha).toMatch(/'source', v_source/);
  });

  it("§5 — desligar audita tanto quanto ligar", () => {
    // ⚠️ A ASSERÇÃO É SOBRE A AUSÊNCIA DE UMA CONDIÇÃO. Se a escrita da trilha
    // estivesse dentro de um `if p_present then`, a reversão sumiria do
    // histórico — e o §5 é explícito: "a alteração para OFF também deve gerar
    // auditoria".
    expect(trilha).not.toMatch(/if\s+p_present\s+then/i);
    expect(trilha).not.toMatch(/where\s+p_present/i);
  });

  it("não guarda nome, e-mail nem telefone", () => {
    // A trilha desta plataforma não carrega dado pessoal: quem precisa saber de
    // quem se trata consulta a tabela, que está sob RLS.
    expect(trilha).not.toMatch(/full_name|email|phone|whatsapp|company_name/i);
  });

  it("a trilha continua sendo só INSERT — nada a reescreve", () => {
    // O histórico de uma presença revertida não pode ser perdido (§13). Ele
    // sobrevive porque ninguém apaga nem atualiza a trilha.
    expect(codigo).not.toMatch(/update\s+public\.event_registration_audit_logs/i);
    expect(codigo).not.toMatch(/delete\s+from\s+public\.event_registration_audit_logs/i);
  });
});

/* ========================================================================== */
/* §9, §14, §15, §16 — o quadro                                              */
/* ========================================================================== */

describe("§9, §15 e §16 — o quadro reusado", () => {
  const corpo = corpoDe("event_registrations_board");

  it("a assinatura antiga é derrubada antes de recriar", () => {
    // ⚠️ SEM O `drop`, A NOVA SERIA UMA SOBRECARGA e a chamada por nome de
    // argumento do PostgREST ficaria ambígua (42725). É a armadilha que
    // 20260905000000 documenta.
    const drop = codigo.indexOf("drop function if exists public.event_registrations_board");
    const create = codigo.indexOf("create or replace function public.event_registrations_board");
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
  });

  it("§15 — o filtro de presença vira booleano uma vez, fora do where", () => {
    // Comparar texto dentro do `where` faria o planejador perder o índice
    // `(event_id, present)`.
    expect(corpo).toMatch(
      /v_present boolean := case lower\(btrim\(coalesce\(p_presence, ''\)\)\)/i,
    );
    expect(corpo).toMatch(/when 'present' then true/i);
    expect(corpo).toMatch(/when 'absent' then false/i);
  });

  it("§15 — valor desconhecido cai em 'todos', e não em lista vazia", () => {
    // Uma URL colada errada não deve parecer "ninguém compareceu".
    expect(corpo).toMatch(/else null\s*\n\s*end;/i);
    expect(corpo).toMatch(/and \(v_present is null or p\.present = v_present\)/i);
  });

  it("§9 — presentes e ausentes saem da MESMA CTE das linhas", () => {
    // Contá-los à parte abriria a porta para a tela dizer "73 presentes" sobre
    // uma lista de 5.
    const metricas = corpo.slice(corpo.indexOf("metricas as ("), corpo.indexOf("pagina as ("));
    expect(metricas).toMatch(/count\(\*\) filter \(where present\)\s+as present/i);
    expect(metricas).toMatch(/count\(\*\) filter \(where not present\)\s+as absent/i);
    expect(metricas).toMatch(/from filtrado/i);
  });

  it("§9 — ausentes é CONTADO, e não subtraído", () => {
    expect(corpo).not.toMatch(/participants\s*-\s*present/i);
  });

  it("§10 — a linha traz present e checkedInAt", () => {
    expect(corpo).toMatch(/'present', present/);
    expect(corpo).toMatch(/'checkedInAt', checked_in_at/);
  });

  it("§10 — a linha NÃO traz checked_in_by", () => {
    // Trazê-lo exigiria juntar com `profiles` para ter o nome, e a policy de
    // `profiles` só devolve a própria linha para quem não é administrador — a
    // coluna apareceria vazia para o Atendente, sem aviso nenhum. Um campo que
    // some conforme quem olha é pior que um campo ausente.
    const linhas = corpo.slice(corpo.indexOf("'rows',"));
    expect(linhas).not.toMatch(/checked_in_by/i);
  });

  it("continua NÃO sendo security definer", () => {
    // A RLS de `event_participants` é a segunda camada desta leitura. Um DEFINER
    // desligaria justamente a proteção que faz sentido nesta porta.
    expect(corpo).not.toMatch(/security definer/i);
  });

  it("§14 — a busca continua atravessando as duas tabelas", () => {
    // A granja mora na inscrição, a pessoa mora no participante. Uma regressão
    // aqui faria a Lista de Presença deixar de achar por empresa.
    expect(corpo).toMatch(/p\.search_text like/i);
    expect(corpo).toMatch(/r\.search_text like/i);
    expect(corpo).toMatch(/v_digitos is not null and p\.search_text like/i);
  });

  it("§18 — a leitura amarra participante e inscrição ao mesmo evento", () => {
    expect(corpo).toMatch(/where p\.event_id = p_event_id/i);
    expect(corpo).toMatch(/and r\.event_id = p_event_id/i);
  });

  it("§16 — o tamanho da página é limitado no próprio SQL", () => {
    // Um `p_limit` vindo da URL não pode pedir o evento inteiro.
    expect(corpo).toMatch(/greatest\(1, least\(coalesce\(p_limit, 25\), 200\)\)/i);
  });

  it("a ordenação continua sem interpolar texto recebido", () => {
    // `p_sort` vem da URL: um `order by` montado com texto de fora é injeção de
    // SQL por outro nome.
    expect(corpo).toMatch(/case when v_sort = 'company'/i);
    expect(corpo).not.toMatch(/execute\s+/i);
  });

  it("a ordenação mantém o desempate estável por id", () => {
    // Sem ele, duas pessoas inscritas no mesmo segundo trocam de lugar entre a
    // página 1 e a 2 — e uma delas some da listagem.
    expect(corpo).toMatch(/f\.participant_id asc/i);
  });

  it("os grants são reescritos depois do drop", () => {
    // ⚠️ UM `drop` LEVA OS GRANTS JUNTO. Sem reescrevê-los, a função nasceria
    // executável por `public`, que é o padrão do Postgres e o oposto do que este
    // módulo faz.
    expect(codigo).toMatch(
      /revoke execute on function\s+public\.event_registrations_board\(uuid, text, text, date, date, text, integer, integer, text\)\s+from public, anon;/i,
    );
    expect(codigo).toMatch(
      /grant execute on function\s+public\.event_registrations_board\(uuid, text, text, date, date, text, integer, integer, text\)\s+to authenticated;/i,
    );
  });
});

/* ========================================================================== */
/* §19 — as duas camadas de permissão contam a mesma história                */
/* ========================================================================== */

describe("§19 — permissões", () => {
  it("os helpers existem e são revogados de anon", () => {
    expect(codigo).toMatch(/create or replace function public\.presence_is_reader\(\)/i);
    expect(codigo).toMatch(/create or replace function public\.presence_is_writer\(\)/i);
    expect(codigo).toMatch(
      /revoke execute on function public\.presence_is_reader\(\) from public, anon;/i,
    );
    expect(codigo).toMatch(
      /revoke execute on function public\.presence_is_writer\(\) from public, anon;/i,
    );
  });

  it("o helper do banco lista os MESMOS papéis que a matriz do TypeScript", () => {
    /**
     * ⚠️ AS DUAS CAMADAS TÊM DE CONTAR A MESMA HISTÓRIA, e é o tipo de coisa que
     * diverge em silêncio: alguém restringe a matriz e esquece a função, ou o
     * contrário. O sintoma seria uma tela que abre e não grava (ou pior, uma que
     * não abre para quem o banco deixaria escrever).
     */
    const reader = codigo.slice(codigo.indexOf("function public.presence_is_reader"));
    const writer = codigo.slice(codigo.indexOf("function public.presence_is_writer"));

    for (const papel of PERMISSION_MATRIX["presence.read"]) {
      expect(reader.slice(0, 500)).toContain(`'${papel}'`);
    }
    for (const papel of PERMISSION_MATRIX["presence.write"]) {
      expect(writer.slice(0, 500)).toContain(`'${papel}'`);
    }
  });

  it("a escrita da presença é MAIS LARGA que a das inscrições, e é deliberado", () => {
    /**
     * ⚠️ ESTE CASO EXISTE PARA SER LIDO, e não só para passar. A exceção é a
     * decisão de negócio do §19: marcar quem entrou pela porta não é uma decisão
     * editorial, é o trabalho de quem está na porta. Uma lista de presença que
     * só o Administrador consegue marcar não é uma lista de presença.
     *
     * Se um dia alguém quiser fechar isso, este caso quebra — e é aqui que a
     * conversa acontece, em vez de a mudança passar despercebida.
     */
    expect(PERMISSION_MATRIX["presence.write"]).toContain("comercial");
    expect(PERMISSION_MATRIX["registrations.write"]).not.toContain("comercial");
  });

  it("o teto e os cargos embutidos são semeados na mesma migration", () => {
    // Só o teto não basta: quem decide o que uma pessoa vê é o CARGO dela, e os
    // embutidos foram semeados com uma cópia do teto DAQUELE momento. Sem esta
    // segunda escrita, o item de menu ficaria invisível até para o Administrador.
    expect(codigo).toMatch(
      /insert into public\.app_role_ceilings \(base_role, permission\) values/i,
    );
    expect(codigo).toMatch(/\('admin', 'presence\.read'\)/);
    expect(codigo).toMatch(/\('admin', 'presence\.write'\)/);
    expect(codigo).toMatch(/\('comercial', 'presence\.read'\)/);
    expect(codigo).toMatch(/\('comercial', 'presence\.write'\)/);

    expect(codigo).toMatch(/insert into public\.app_role_permissions \(role_key, permission\)/i);
    expect(codigo).toMatch(/where r\.is_builtin/i);
    expect(codigo).toMatch(/c\.permission in \('presence\.read', 'presence\.write'\)/i);
  });
});
