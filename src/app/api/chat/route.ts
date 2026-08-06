import { NextResponse, type NextRequest } from "next/server";
import {
  canStartConversation,
  handleUserMessage,
  resumeConversation,
  startConversation,
} from "@/lib/chat/engine";
import { CHAT_SESSION_COOKIE, chatSessionCookieOptions, hashIp } from "@/lib/chat/session";
import { chatMessageInputSchema } from "@/modules/chat/chat.schema";
import { renderCspContent } from "@/modules/chat/flows/csp.content";

/**
 * API do chat público (anônimo).
 *
 * É a ÚNICA porta de entrada de escrita nas tabelas do chat — as policies de
 * RLS não permitem que `anon` escreva nada direto no Supabase. A conversa é
 * identificada pelo cookie httpOnly, nunca por um id vindo do corpo da
 * requisição (senão qualquer um leria a conversa alheia trocando o id).
 *
 * GET  → retoma a conversa do cookie, ou abre uma nova.
 * POST → envia uma mensagem e recebe a resposta do bot.
 */

// `node:crypto` e o cliente service_role exigem runtime Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Corpo máximo aceito. A mensagem é limitada a 1000 caracteres pelo Zod, mas
 *  a validação só roda depois de bufferizar o corpo — este teto vem antes. */
const MAX_BODY_BYTES = 4096;

/**
 * Headers que a borda REESCREVE (o cliente não consegue forjá-los), em ordem de
 * preferência. `x-forwarded-for` fica por último porque vários proxies apenas
 * ACRESCENTAM ao valor recebido: nesse caso o primeiro elemento é escolhido
 * pelo cliente, e confiar nele zeraria o limite por IP.
 */
const TRUSTED_IP_HEADERS = ["x-vercel-forwarded-for", "cf-connecting-ip", "true-client-ip"];

function getClientIpHash(request: NextRequest): string | null {
  for (const header of TRUSTED_IP_HEADERS) {
    const value = request.headers.get(header)?.trim();
    if (value) return hashIp(value);
  }

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip")?.trim();
  return ip ? hashIp(ip) : null;
}

/** Nunca cachear: a resposta carrega a transcrição (com dado pessoal). */
function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}

function serverErrorResponse() {
  return noStore(
    NextResponse.json(
      {
        messages: [{ role: "bot", content: renderCspContent("unavailable") }],
        options: [],
        closed: false,
      },
      { status: 500 },
    ),
  );
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(CHAT_SESSION_COOKIE)?.value;

    if (token) {
      const resumed = await resumeConversation(token);
      // Conversa encerrada: começa uma nova, como o próprio bot promete em
      // `conversationClosed` ("é só recarregar a página"). Sem isso o cookie de
      // 30 dias prendia a pessoa numa conversa concluída.
      if (resumed && !resumed.closed) return noStore(NextResponse.json(resumed));
    }

    const ipHash = getClientIpHash(request);
    if (!(await canStartConversation(ipHash))) {
      return noStore(
        NextResponse.json(
          {
            messages: [{ role: "bot", content: renderCspContent("rateLimited") }],
            options: [],
            closed: true,
          },
          { status: 429 },
        ),
      );
    }

    const { token: newToken, response } = await startConversation({
      ipHash,
      userAgent: request.headers.get("user-agent"),
    });

    const json = noStore(
      NextResponse.json({
        messages: response.messages.map((m) => ({ role: "bot" as const, content: m.content })),
        options: response.options,
        closed: response.closed,
      }),
    );
    json.cookies.set(CHAT_SESSION_COOKIE, newToken, chatSessionCookieOptions);
    return json;
  } catch (error) {
    console.error(`[api.chat] GET falhou: ${error instanceof Error ? error.message : error}`);
    return serverErrorResponse();
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(CHAT_SESSION_COOKIE)?.value;
    if (!token) {
      return noStore(NextResponse.json({ error: "session_expired" }, { status: 409 }));
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
      return noStore(NextResponse.json({ error: "payload_too_large" }, { status: 413 }));
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = chatMessageInputSchema.safeParse(body);
    if (!parsed.success) {
      return noStore(NextResponse.json({ error: "invalid_input" }, { status: 400 }));
    }

    const result = await handleUserMessage({
      token,
      message: parsed.data.message,
      optionValue: parsed.data.optionValue,
    });

    if (!result) {
      // Cookie aponta para uma conversa que não existe mais.
      const expired = noStore(NextResponse.json({ error: "session_expired" }, { status: 409 }));
      expired.cookies.delete(CHAT_SESSION_COOKIE);
      return expired;
    }

    return noStore(
      NextResponse.json({
        messages: result.messages.map((m) => ({ role: "bot" as const, content: m.content })),
        options: result.options,
        closed: result.closed,
      }),
    );
  } catch (error) {
    console.error(`[api.chat] POST falhou: ${error instanceof Error ? error.message : error}`);
    return serverErrorResponse();
  }
}
