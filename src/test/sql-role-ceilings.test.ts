import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_MATRIX } from "@/lib/rbac/rbac.config";
import type { Permission, Role } from "@/lib/rbac/rbac.types";

/**
 * AS DUAS CAMADAS DE PERMISSÃO CONTAM A MESMA HISTÓRIA?
 *
 * `PERMISSION_MATRIX` (TypeScript) declara o que cada papel recebe. Ele é
 * COPIADO para `app_role_ceilings` no banco, que é quem impede um cargo criado
 * pela APCS de prometer mais do que a RLS entrega. O comentário da tabela é
 * explícito: "Mudou policy? Mude aqui, na mesma migration."
 *
 * ⚠️ NADA GARANTIA ISSO ATÉ AGORA. Uma permissão acrescentada só no TypeScript
 * abriria a tela e deixaria a Matriz de Acesso sem a linha correspondente;
 * acrescentada só no SQL, faria o contrário. Os dois erros são silenciosos.
 *
 * ⚠️ E EXISTE UM TERCEIRO, PIOR QUE OS DOIS. `app_role_ceilings` é só o TETO —
 * quem decide o que uma pessoa vê é o CARGO dela (`app_role_permissions`). Os
 * cargos embutidos foram semeados em 20260903000100 com uma cópia do teto
 * DAQUELE momento, então uma permissão acrescentada depois entra no teto e não
 * entra em cargo nenhum. O resultado é o pior tipo de defeito: RLS liberada,
 * tela no ar, e o item de menu invisível até para o Administrador.
 *
 * Este arquivo cobre os três.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const arquivos = readdirSync(MIGRATIONS)
  .filter((nome) => nome.endsWith(".sql"))
  .sort();

/** `admin|documents.read` → o arquivo que a introduziu. */
const tetos = new Map<string, string>();

/** Arquivos que semeiam os cargos embutidos a partir do teto. */
const semeadores: string[] = [];

/** Arquivos que mexem no teto sem semear cargo nenhum. */
const semSemeadura: string[] = [];

for (const arquivo of arquivos) {
  // ⚠️ SEM OS COMENTÁRIOS, e isto não é detalhe: toda migration deste projeto
  // termina com um bloco ROLLBACK escrito em linhas comentadas. Lendo o texto
  // cru, um `delete from app_role_ceilings` comentado seria contado como real.
  const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8").replace(/--[^\n]*/g, "");

  const insereTeto = /insert\s+into\s+public\.app_role_ceilings\b/i.test(sql);

  // ⚠️ O RECONHECIMENTO DO SEMEADOR EXIGE AS TRÊS PEÇAS: escrever em
  // `app_role_permissions`, ler de `app_role_ceilings` e filtrar por
  // `is_builtin`. Um `insert` qualquer naquela tabela (dar uma permissão a um
  // cargo específico, por exemplo) não semeia os embutidos, e aceitá-lo aqui
  // faria o teste aprovar exatamente o caso que ele existe para pegar.
  const semeia =
    /insert\s+into\s+public\.app_role_permissions\b/i.test(sql) &&
    /app_role_ceilings/i.test(sql) &&
    /is_builtin/i.test(sql);

  if (semeia) semeadores.push(arquivo);
  if (insereTeto && !semeia) semSemeadura.push(arquivo);

  // As tuplas `('papel', 'permissao')` de cada `insert into app_role_ceilings`.
  for (const bloco of sql.split(/insert\s+into\s+public\.app_role_ceilings/i).slice(1)) {
    // Para no primeiro `;`: o resto do arquivo não é mais este insert.
    const corpo = bloco.split(";")[0] ?? "";
    for (const tupla of corpo.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_.]+)'\s*\)/gi)) {
      const chave = `${tupla[1]}|${tupla[2]}`;
      if (!tetos.has(chave)) tetos.set(chave, arquivo);
    }
  }
}

/** O mesmo conjunto, montado a partir do TypeScript. */
const doCodigo = new Set<string>();
for (const [permissao, papeis] of Object.entries(PERMISSION_MATRIX) as [Permission, Role[]][]) {
  for (const papel of papeis) {
    // `viewer` nunca entra no teto: ele não tem permissão nenhuma, e é assim de
    // propósito (é o papel de quem acabou de entrar, e o destino de quem falhou).
    //
    // Os aposentados de 20260902000000 (`ceo`, `pm`, `tech_lead`) não precisam
    // ser filtrados: `VALID_ROLES` já não os contém, então eles não chegam aqui.
    if (papel === "viewer") continue;
    doCodigo.add(`${papel}|${permissao}`);
  }
}

describe("teto de permissões: código e banco", () => {
  it("o teste está de fato lendo as migrations", () => {
    // Sem isto, uma expressão regular quebrada transformaria a bateria num teste
    // que passa sobre conjuntos vazios — o pior tipo de guarda.
    expect(arquivos.length).toBeGreaterThan(10);
    expect(tetos.size).toBeGreaterThan(30);
    expect(semeadores.length).toBeGreaterThan(0);
    expect(tetos.has("admin|users.manage")).toBe(true);
    expect(tetos.has("comercial|documents.read")).toBe(true);
  });

  it("nenhuma permissão existe só no TypeScript", () => {
    const faltando = [...doCodigo].filter((chave) => !tetos.has(chave)).sort();

    expect(
      faltando,
      `\n\nPermissões em PERMISSION_MATRIX que NÃO estão em app_role_ceilings:\n\n` +
        faltando.map((c) => `  ${c.replace("|", " → ")}`).join("\n") +
        `\n\nA tela abre e a Matriz de Acesso não conhece a permissão. O conserto é um\n` +
        `\`insert into public.app_role_ceilings\` na migration do módulo.\n`,
    ).toEqual([]);
  });

  it("nenhuma permissão existe só no banco", () => {
    const sobrando = [...tetos.keys()].filter((chave) => !doCodigo.has(chave)).sort();

    expect(
      sobrando,
      `\n\nLinhas de app_role_ceilings que NÃO estão em PERMISSION_MATRIX:\n\n` +
        sobrando.map((c) => `  ${c.replace("|", " → ")} (${tetos.get(c)})`).join("\n") +
        `\n\nO banco promete algo que o código não conhece: a Matriz de Acesso ofereceria\n` +
        `uma caixa que nenhuma tela consulta.\n`,
    ).toEqual([]);
  });

  /**
   * ⚠️ ESTE É O QUE PEGA O DEFEITO INVISÍVEL. Um teto sem semeadura deixa a
   * permissão existindo em toda parte — RLS, matriz, código — e em nenhum cargo.
   * Ninguém vê a tela, e nada no sistema diz por quê.
   */
  it("toda migration que mexe no teto também semeia os cargos embutidos", () => {
    expect(
      semSemeadura,
      `\n\nMigrations que inserem em app_role_ceilings SEM semear app_role_permissions:\n\n` +
        semSemeadura.map((a) => `  ${a}`).join("\n") +
        `\n\nO teto sobe e nenhum cargo recebe a permissão nova — nem o Administrador.\n` +
        `A tela fica no ar e o item de menu, invisível para todo mundo.\n\n` +
        `Conserto, na mesma migration:\n\n` +
        `  insert into public.app_role_permissions (role_key, permission)\n` +
        `  select r.key, c.permission\n` +
        `  from public.app_roles r\n` +
        `  join public.app_role_ceilings c on c.base_role = r.base_role\n` +
        `  where r.is_builtin and c.permission in (...)\n` +
        `  on conflict do nothing;\n`,
    ).toEqual([]);
  });
});
