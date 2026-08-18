import { safeCompare } from "./signature";

/**
 * Quem pode acionar um job (§18 aplicado às rotas de rotina).
 *
 * ⚠️ ESTAS ROTAS SÃO PÚBLICAS NA INTERNET. Sem segredo, qualquer pessoa
 * conseguiria disparar campanhas de WhatsApp em nome da APCS — que custa
 * dinheiro por conversa iniciada e queima a reputação do número.
 *
 * Dois formatos aceitos, pelo mesmo segredo:
 *
 *   • `Authorization: Bearer <segredo>` — é o que o Vercel Cron manda
 *     automaticamente quando `CRON_SECRET` está definida;
 *   • `x-apcs-job-secret: <segredo>` — para acionar à mão (curl, n8n, um cron
 *     externo), sem depender da plataforma.
 *
 * ⚠️ SEM SEGREDO CONFIGURADO A ROTA RECUSA. A alternativa — "libera enquanto
 * ninguém configurou" — é a que transforma um esquecimento de deploy num
 * endpoint aberto de envio de mensagem.
 */

export type JobAuth = { ok: true } | { ok: false; status: 401 | 503; reason: string };

export function authorizeJob(headers: Headers, env: NodeJS.ProcessEnv = process.env): JobAuth {
  const segredo = (env.APCS_JOB_SECRET ?? env.CRON_SECRET)?.trim();

  if (!segredo) {
    // 503 e não 401: o problema é do servidor (falta configuração), e devolver
    // 401 faria quem opera procurar o erro no lado errado.
    return { ok: false, status: 503, reason: "APCS_JOB_SECRET não configurada" };
  }

  const bearer = headers.get("authorization")?.trim();
  const token = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null;

  if (safeCompare(token, segredo)) return { ok: true };
  if (safeCompare(headers.get("x-apcs-job-secret"), segredo)) return { ok: true };

  return { ok: false, status: 401, reason: "segredo ausente ou inválido" };
}
