/**
 * Stub de `server-only` para os testes.
 *
 * O pacote real é fornecido pelo Next.js em tempo de build e existe para
 * QUEBRAR o bundle quando um módulo de servidor é importado por código de
 * cliente. Fora do Next ele não resolve, e sem este arquivo nenhum service ou
 * action poderia ser testado — a marcação que protege a produção impediria
 * justamente os testes que provam que ela está certa.
 *
 * ⚠️ O alias vive só em `vitest.config.ts`. O build de produção continua usando
 * o pacote de verdade, então a proteção segue valendo onde importa.
 */
export {};
