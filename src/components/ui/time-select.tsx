"use client";

import { useId } from "react";
import { TIME_STEP_MINUTES } from "@/lib/time/step";
import { Select } from "@/components/ui/select";

/**
 * HORÁRIO EM DOIS SELETORES — hora e minuto —, no lugar do `<input type="time">`.
 *
 * ⚠️ POR QUE NÃO O CAMPO NATIVO COM `step`. Era o que existia aqui, e o `step`
 * de 300 segundos deveria fazer o seletor do Chrome listar 00, 05, 10... 55. Na
 * prática ele lista os sessenta minutos: `step` vale para a VALIDAÇÃO do
 * navegador, não para a lista que ele desenha. O resultado era um seletor que
 * oferecia 14:56 e um Zod que recusava — a pessoa escolhia e o formulário
 * reclamava de um horário que a própria tela tinha sugerido.
 *
 * Com dois `<select>`, o horário fora da grade deixa de existir: não há o que
 * escolher. A validação do Zod continua lá — ela é quem barra uma chamada à
 * Server Action feita por fora —, mas ela para de aparecer para quem usa a tela.
 *
 * ⚠️ DOIS CAMPOS, UM VALOR. Para fora, isto é um `string` "HH:MM" (ou "" quando
 * opcional e vazio), que é exatamente o que o `<input type="time">` produzia —
 * então schema, banco e mensagem de WhatsApp não sabem que algo mudou.
 */

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

const MINUTES = Array.from({ length: 60 / TIME_STEP_MINUTES }, (_, i) =>
  String(i * TIME_STEP_MINUTES).padStart(2, "0"),
);

export function TimeSelect({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  label,
}: {
  id: string;
  /** "HH:MM", ou "" para vazio. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Opcional (falso) ganha a opção em branco nos dois seletores. */
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Vai para o `aria-label` de cada seletor: "Hora de início — hora". */
  label: string;
}) {
  const minuteId = useId();

  const [hora = "", minuto = ""] = value ? value.split(":") : ["", ""];

  /**
   * ⚠️ MEIO HORÁRIO NÃO É HORÁRIO. Enquanto só a hora estiver escolhida, o valor
   * que sai é "" — e não "14:" nem "14:00". "14:00" seria o sistema inventando
   * um minuto que ninguém escolheu, e é o tipo de palpite que vira uma palestra
   * anunciada no horário errado.
   *
   * O minuto começa em "00" assim que a hora é escolhida, porque é o caso
   * esmagadoramente comum e poupa um clique — mas isso é um PADRÃO VISÍVEL na
   * caixa, não um valor escondido.
   */
  function trocarHora(nova: string): void {
    if (!nova) return onChange("");
    onChange(`${nova}:${minuto || "00"}`);
  }

  function trocarMinuto(novo: string): void {
    if (!novo) return onChange("");
    // Sem hora escolhida, um minuto sozinho não forma horário nenhum.
    if (!hora) return onChange("");
    onChange(`${hora}:${novo}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        id={id}
        aria-label={`${label} — hora`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={hora}
        disabled={disabled}
        onChange={(evento) => trocarHora(evento.target.value)}
        className="w-24"
      >
        {!required && <option value="">--</option>}
        {/* Obrigatório e ainda vazio: a opção em branco existe até alguém
            escolher, senão o campo mentiria mostrando "00" sem ninguém ter
            escolhido meia-noite. */}
        {required && hora === "" && <option value="">--</option>}
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>

      <span aria-hidden="true" className="text-muted-foreground">
        :
      </span>

      <Select
        id={minuteId}
        aria-label={`${label} — minuto`}
        aria-invalid={invalid || undefined}
        value={minuto}
        disabled={disabled}
        onChange={(evento) => trocarMinuto(evento.target.value)}
        className="w-24"
      >
        {!required && <option value="">--</option>}
        {required && minuto === "" && <option value="">--</option>}
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </Select>
    </div>
  );
}
