import { describe, expect, it } from "vitest";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { TIME_STEP_MINUTES, TIME_STEP_SECONDS } from "@/lib/time/step";
import {
  createEventFormSchema,
  createEventSchema,
  editEventFormSchema,
  EVENT_DATE_IN_PAST_MESSAGE,
  eventFormSchema,
  imageExtensionOf,
  isSafeHttpUrl,
  MAX_IMAGE_SIZE_BYTES,
  updateEventSchema,
  validateImageCandidate,
} from "./event.schema";

const HOJE = "2026-08-12";
const SEGMENTO = "3f1b7c9e-2a4d-4f8b-9c1e-0d5a6b7c8e9f";

function formulario(overrides: Record<string, unknown> = {}) {
  return {
    name: "Workshop APCS",
    location: "Auditório APCS",
    eventDate: "2026-08-20",
    startTime: "14:00",
    endTime: "17:00",
    segmentIds: [SEGMENTO],
    ...overrides,
  };
}

describe("eventFormSchema — campos obrigatórios", () => {
  it("aceita um evento válido", () => {
    expect(eventFormSchema.safeParse(formulario()).success).toBe(true);
  });

  it("recusa sem nome", () => {
    expect(eventFormSchema.safeParse(formulario({ name: "" })).success).toBe(false);
    expect(eventFormSchema.safeParse(formulario({ name: "  " })).success).toBe(false);
  });

  it("recusa local vazio", () => {
    expect(eventFormSchema.safeParse(formulario({ location: "" })).success).toBe(false);
  });

  // Texto livre: "Online" é um local válido, e não precisa de estrutura de
  // endereço nenhuma.
  it("aceita 'Online' como local", () => {
    expect(eventFormSchema.safeParse(formulario({ location: "Online" })).success).toBe(true);
  });

  it("recusa data vazia", () => {
    expect(eventFormSchema.safeParse(formulario({ eventDate: "" })).success).toBe(false);
  });

  it("recusa hora de início vazia", () => {
    expect(eventFormSchema.safeParse(formulario({ startTime: "" })).success).toBe(false);
  });

  it("exige ao menos um público-alvo", () => {
    expect(eventFormSchema.safeParse(formulario({ segmentIds: [] })).success).toBe(false);
  });
});

describe("eventFormSchema — data", () => {
  // A regex sozinha aprova 31 de fevereiro. Reconstruir a string a partir da
  // data interpretada é o que separa uma data possível de uma que só parece.
  it("recusa uma data que não existe", () => {
    expect(eventFormSchema.safeParse(formulario({ eventDate: "2026-02-31" })).success).toBe(false);
  });

  it("recusa o formato brasileiro digitado à mão", () => {
    expect(eventFormSchema.safeParse(formulario({ eventDate: "20/08/2026" })).success).toBe(false);
  });
});

describe("eventFormSchema — horários", () => {
  it("aceita sem hora de término", () => {
    expect(eventFormSchema.safeParse(formulario({ endTime: undefined })).success).toBe(true);
    expect(eventFormSchema.safeParse(formulario({ endTime: "" })).success).toBe(true);
  });

  it("recusa término anterior ao início", () => {
    const resultado = eventFormSchema.safeParse(
      formulario({ startTime: "17:00", endTime: "14:00" }),
    );
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0]?.message).toBe(
        "O horário de término não pode ser anterior ao horário de início.",
      );
    }
  });

  it("aceita término igual ao início", () => {
    expect(
      eventFormSchema.safeParse(formulario({ startTime: "14:00", endTime: "14:00" })).success,
    ).toBe(true);
  });

  it("recusa horário fora do relógio", () => {
    expect(eventFormSchema.safeParse(formulario({ startTime: "25:00" })).success).toBe(false);
    expect(eventFormSchema.safeParse(formulario({ startTime: "14:70" })).success).toBe(false);
  });
});

describe("isSafeHttpUrl — o link de inscrição é dado externo não confiável", () => {
  // ⚠️ O teste que justifica esta função existir: `z.string().url()` ACEITA
  // isto, porque é uma URL válida. Num `href`, é XSS na tela de quem clicar.
  it("recusa javascript:", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("recusa data: e file:", () => {
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("aceita http e https", () => {
    expect(isSafeHttpUrl("https://apcs.org.br/inscricao")).toBe(true);
    expect(isSafeHttpUrl("http://apcs.org.br/inscricao")).toBe(true);
  });

  it("recusa texto que não é URL", () => {
    expect(isSafeHttpUrl("apcs.org.br")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
  });

  // O CHECK do banco exige uma URL sem espaços; recusar aqui dá a mensagem
  // certa em vez de um "dados inválidos" genérico vindo do Postgres.
  it("recusa URL com espaço", () => {
    expect(isSafeHttpUrl("https://apcs.org.br/inscricao com espaco")).toBe(false);
  });
});

describe("eventFormSchema — link de inscrição", () => {
  it("é opcional", () => {
    expect(eventFormSchema.safeParse(formulario()).success).toBe(true);
    expect(eventFormSchema.safeParse(formulario({ registrationUrl: "" })).success).toBe(true);
  });

  it("aceita um link válido", () => {
    expect(
      eventFormSchema.safeParse(formulario({ registrationUrl: "https://apcs.org.br/x" })).success,
    ).toBe(true);
  });

  it("recusa um link com protocolo executável", () => {
    expect(
      eventFormSchema.safeParse(formulario({ registrationUrl: "javascript:alert(1)" })).success,
    ).toBe(false);
  });
});

describe("editEventFormSchema — mover a data para o passado", () => {
  const ORIGINAL_PASSADA = "2026-07-01";

  // A regra que o `update_event` impõe no Postgres. Sem ela, um evento expirado
  // ficaria impossível de editar: qualquer edição carrega a data atual dele
  // junto, e ela já está no passado.
  it("permite MANTER uma data que já passou", () => {
    const schema = editEventFormSchema(HOJE, ORIGINAL_PASSADA);
    expect(schema.safeParse(formulario({ eventDate: ORIGINAL_PASSADA })).success).toBe(true);
  });

  it("recusa MOVER a data para outro dia no passado", () => {
    const schema = editEventFormSchema(HOJE, ORIGINAL_PASSADA);
    expect(schema.safeParse(formulario({ eventDate: "2026-07-15" })).success).toBe(false);
  });

  // Remarcar um evento expirado para o futuro é o caminho de recuperação.
  it("permite remarcar um evento expirado para o futuro", () => {
    const schema = editEventFormSchema(HOJE, ORIGINAL_PASSADA);
    expect(schema.safeParse(formulario({ eventDate: "2026-09-10" })).success).toBe(true);
  });
});

/**
 * Duas mensagens para a mesma regra é como o usuário descobre que o formulário
 * e o servidor discordam. Este teste trava as duas pontas.
 */
describe("mensagem única de data no passado", () => {
  it("o schema e a mensagem da action dizem exatamente a mesma coisa", () => {
    expect(EVENT_DATE_IN_PAST_MESSAGE).toBe(ACTION_ERROR_MESSAGES.eventDateInPast);
  });
});

describe("createEventFormSchema — evento não nasce no passado", () => {
  const schema = createEventFormSchema(HOJE);

  it("aceita data futura", () => {
    expect(schema.safeParse(formulario({ eventDate: "2026-08-20" })).success).toBe(true);
  });

  it("aceita o dia de hoje", () => {
    expect(schema.safeParse(formulario({ eventDate: HOJE })).success).toBe(true);
  });

  it("recusa data anterior a hoje com a mensagem do escopo", () => {
    const resultado = schema.safeParse(formulario({ eventDate: "2026-08-11" }));
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0]?.message).toBe(
        "Não é possível cadastrar um evento com data anterior à data atual.",
      );
    }
  });
});

describe("imageExtensionOf", () => {
  it("devolve a extensão em minúsculas", () => {
    expect(imageExtensionOf("Cartaz.JPG")).toBe(".jpg");
    expect(imageExtensionOf("foto.jpeg")).toBe(".jpeg");
  });

  it("pega a última extensão de um nome com vários pontos", () => {
    expect(imageExtensionOf("cartaz.final.v2.png")).toBe(".png");
  });

  it("devolve null quando não há extensão", () => {
    expect(imageExtensionOf("cartaz")).toBeNull();
    expect(imageExtensionOf(".gitignore")).toBeNull();
  });
});

describe("validateImageCandidate", () => {
  function arquivo(overrides: Partial<{ name: string; size: number; type: string }> = {}) {
    return { name: "cartaz.jpg", size: 1024, type: "image/jpeg", ...overrides };
  }

  it("aceita os quatro nomes de extensão permitidos", () => {
    for (const nome of ["a.jpg", "a.jpeg", "a.png", "a.webp"]) {
      expect(validateImageCandidate(arquivo({ name: nome, type: "" }))).toBeNull();
    }
  });

  it("recusa extensão fora da lista", () => {
    expect(validateImageCandidate(arquivo({ name: "cartaz.gif", type: "" }))).toBe("fileNotImage");
    expect(validateImageCandidate(arquivo({ name: "cartaz.pdf", type: "" }))).toBe("fileNotImage");
    expect(validateImageCandidate(arquivo({ name: "cartaz", type: "" }))).toBe("fileNotImage");
  });

  it("recusa MIME declarado fora da lista", () => {
    expect(validateImageCandidate(arquivo({ type: "application/pdf" }))).toBe("fileNotImage");
  });

  // Alguns navegadores não informam o MIME. Reprovar por isso barraria upload
  // legítimo, e a verificação que vale mesmo acontece no servidor.
  it("aceita MIME ausente", () => {
    expect(validateImageCandidate(arquivo({ type: "" }))).toBeNull();
  });

  it("aceita EXATAMENTE 5 MB", () => {
    expect(validateImageCandidate(arquivo({ size: MAX_IMAGE_SIZE_BYTES }))).toBeNull();
  });

  it("recusa 5 MB mais um byte", () => {
    expect(validateImageCandidate(arquivo({ size: MAX_IMAGE_SIZE_BYTES + 1 }))).toBe(
      "fileTooLarge",
    );
  });

  // Arquivo vazio é "não é imagem", não "é grande demais": dizer o contrário
  // mandaria a pessoa procurar um problema de tamanho que não existe.
  it("chama arquivo vazio de 'não é imagem'", () => {
    expect(validateImageCandidate(arquivo({ size: 0 }))).toBe("fileNotImage");
  });
});

/**
 * Os schemas das actions são INTERSEÇÕES entre `eventFormSchema` (que tem
 * `.refine()`, e portanto é um ZodEffects) e um objeto com os campos de
 * armazenamento. Interseção com ZodEffects nem sempre se comporta como se
 * espera, e as quatro actions dependem disto — daí os testes.
 */
describe("createEventSchema e updateEventSchema", () => {
  const EVENTO = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const armazenamento = { eventId: EVENTO, storagePath: `${EVENTO}/x.jpg` };

  it("createEventSchema aceita e devolve os campos dos dois lados", () => {
    const resultado = createEventSchema.safeParse({ ...formulario(), ...armazenamento });
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.name).toBe("Workshop APCS");
      expect(resultado.data.storagePath).toBe(`${EVENTO}/x.jpg`);
    }
  });

  // A prova de que o `.refine()` do formulário continua valendo depois da
  // interseção — se ele se perdesse, a ordem dos horários deixaria de ser
  // checada na action e só o CHECK do banco seguraria.
  it("createEventSchema mantém a regra de ordem dos horários", () => {
    const invertido = { ...formulario({ startTime: "17:00", endTime: "14:00" }), ...armazenamento };
    expect(createEventSchema.safeParse(invertido).success).toBe(false);
  });

  it("createEventSchema exige eventId e storagePath válidos", () => {
    expect(createEventSchema.safeParse(formulario()).success).toBe(false);
    expect(
      createEventSchema.safeParse({ ...formulario(), ...armazenamento, eventId: "nao-e-uuid" })
        .success,
    ).toBe(false);
  });

  // Editar sem trocar a imagem é o caso comum: `storagePath` ausente significa
  // "mantenha a que já está lá".
  it("updateEventSchema aceita sem storagePath", () => {
    const resultado = updateEventSchema.safeParse({ ...formulario(), eventId: EVENTO });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.storagePath).toBeUndefined();
  });
});

describe("eventFormSchema — o passo de 5 minutos", () => {
  /**
   * ⚠️ ESTE BLOCO EXISTE PORQUE O `step` DO CAMPO NÃO VALE NADA AQUI.
   *
   * O formulário é `noValidate` (as mensagens são do Zod, não do navegador),
   * então `step={300}` mexe só na LISTA que o seletor de horário oferece. Quem
   * digitar 08:07 direto na caixa — ou chamar a Server Action por fora — passa
   * pelo campo sem encostar no `step`. A regra de verdade é a do schema, e é
   * ela que estes testes seguram.
   */
  it("aceita os minutos do relógio de 5 em 5", () => {
    for (const minuto of ["00", "05", "15", "30", "45", "55"]) {
      expect(eventFormSchema.safeParse(formulario({ startTime: `14:${minuto}` })).success).toBe(
        true,
      );
    }
  });

  it("recusa um minuto fora do passo", () => {
    expect(eventFormSchema.safeParse(formulario({ startTime: "14:07" })).success).toBe(false);
    expect(eventFormSchema.safeParse(formulario({ startTime: "14:01" })).success).toBe(false);
    expect(eventFormSchema.safeParse(formulario({ startTime: "14:59" })).success).toBe(false);
  });

  it("vale também para a hora de término", () => {
    expect(eventFormSchema.safeParse(formulario({ endTime: "17:23" })).success).toBe(false);
    expect(eventFormSchema.safeParse(formulario({ endTime: "17:20" })).success).toBe(true);
  });

  it("não atrapalha a hora de término vazia, que é opcional", () => {
    expect(eventFormSchema.safeParse(formulario({ endTime: "" })).success).toBe(true);
  });

  it("aponta o erro no campo do horário, e não no formulário inteiro", () => {
    // Uma mensagem sem `path` apareceria solta no rodapé, e a pessoa
    // procuraria qual dos oito campos está errado.
    const r = eventFormSchema.safeParse(formulario({ startTime: "14:07" }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "startTime")).toBe(true);
    }
  });

  it("o passo em segundos é o dos minutos — as duas constantes não divergem", () => {
    // O `<input type="time">` mede `step` em SEGUNDOS; o resto do mundo pensa
    // em minutos. Se alguém trocar a política para 10 minutos num lugar só, o
    // seletor ofereceria um horário que o schema recusa.
    expect(TIME_STEP_SECONDS).toBe(TIME_STEP_MINUTES * 60);
  });
});

/**
 * A DESCRIÇÃO (pedido de 29/08/2026).
 *
 * Campo opcional, e é ele que vai para o WhatsApp abaixo do nome. O teto de 600
 * está repetido no CHECK `events_description_len`; a mensagem tem uma proteção
 * própria contra estourar a legenda — ver `eventWhatsAppMessage`.
 */
describe("eventFormSchema — descrição", () => {
  it("é opcional: evento sem descrição continua válido", () => {
    const r = eventFormSchema.safeParse(formulario({ description: undefined }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeUndefined();
  });

  it("aceita texto e preserva as quebras de linha", () => {
    const texto = "Primeira linha.\nSegunda linha.";
    const r = eventFormSchema.safeParse(formulario({ description: texto }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBe(texto);
  });

  /**
   * ⚠️ VAZIO E AUSENTE PRECISAM SER A MESMA COISA. O banco guarda NULL; se o
   * formulário mandasse "", teríamos dois jeitos de dizer "não há descrição" —
   * e a comparação da trilha de auditoria registraria uma alteração onde nada
   * mudou, toda vez que alguém salvasse o evento.
   */
  it("só espaços vira ausente, e não string vazia", () => {
    const r = eventFormSchema.safeParse(formulario({ description: "   " }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeUndefined();
  });

  it("recusa acima de 600 caracteres", () => {
    expect(eventFormSchema.safeParse(formulario({ description: "D".repeat(600) })).success).toBe(
      true,
    );
    expect(eventFormSchema.safeParse(formulario({ description: "D".repeat(601) })).success).toBe(
      false,
    );
  });
});
