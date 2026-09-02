"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { TimeSelect } from "@/components/ui/time-select";

/**
 * DATA + HORA, com a hora na grade de 5 em 5 minutos.
 *
 * ⚠️ POR QUE NÃO O `<input type="datetime-local">` COM `step`. É a mesma
 * armadilha que `ui/time-select.tsx` descreve: o `step` vale para a VALIDAÇÃO do
 * navegador, não para a lista que ele desenha. O seletor oferecia 12:07, o Zod
 * recusava com "escolha de 5 em 5 minutos", e a pessoa levava um erro por ter
 * escolhido o que a própria tela sugeriu.
 *
 * ⚠️ PARA FORA É UMA STRING "AAAA-MM-DDTHH:MM" — exatamente o que o campo nativo
 * produzia. Quem consome (schema, action, banco) não sabe que algo mudou.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ AS DUAS METADES TÊM ESTADO PRÓPRIO, E É O CORAÇÃO DESTE ARQUIVO
 * ----------------------------------------------------------------------------
 * Meio instante não é instante: sem data, uma hora sozinha não vale nada, e o
 * valor que sai é "". A primeira versão parava aí — e criou um defeito que só
 * aparece usando: quem escolhia a HORA ANTES DA DATA via o seletor voltar para
 * "--" no mesmo instante, porque o que ele mostrava era derivado do valor, e o
 * valor era vazio. A escolha era descartada na frente da pessoa.
 *
 * Por isso as partes vivem aqui dentro. A tela lembra o que foi escolhido;
 * quem recebe o valor continua recebendo "" até as duas metades existirem.
 */
export function DateTimeSelect({
  id,
  label,
  value,
  onChange,
  disabled = false,
  invalid = false,
}: {
  id: string;
  /** Vai para o `aria-label` de cada peça: "Encerramento — data". */
  label: string;
  /** "AAAA-MM-DDTHH:MM", ou "" para vazio. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [data, setData] = useState(() => value.split("T")[0] ?? "");
  const [hora, setHora] = useState(() => value.split("T")[1] ?? "");

  /**
   * Sincroniza quando o valor muda POR FORA — carregar uma enquete existente,
   * ou um reset do formulário.
   *
   * ⚠️ O GUARDA É O QUE IMPEDE O DEFEITO DE VOLTAR. Sem ele, escolher só a hora
   * dispara `onChange("")`, o `value` continua "" e este efeito limparia a hora
   * que a pessoa acabou de escolher. Quando o valor de fora já corresponde ao
   * que está na tela, não há o que sincronizar.
   */
  useEffect(() => {
    const naTela = data && hora ? `${data}T${hora}` : "";
    if (value === naTela) return;

    const [novaData = "", novaHora = ""] = value ? value.split("T") : ["", ""];
    setData(novaData);
    setHora(novaHora);
  }, [value, data, hora]);

  function emitir(novaData: string, novaHora: string): void {
    setData(novaData);
    setHora(novaHora);
    onChange(novaData && novaHora ? `${novaData}T${novaHora}` : "");
  }

  /**
   * ⚠️ AS LARGURAS SÃO O QUE IMPEDE A QUEBRA FEIA. Com o campo de data em `w-44`
   * e os dois seletores em `w-24`, o conjunto pedia ~310px — mais do que a
   * coluna de 290px do diálogo de agendamento. O resultado era a data numa linha
   * e o horário na de baixo, parecendo dois campos sem relação.
   *
   * `min-w-0` no campo de data é o par obrigatório do `flex-1`: sem ele, a
   * largura mínima intrínseca do `<input type="date">` (o "dd/mm/aaaa" mais o
   * ícone) impede o encolhimento e a quebra volta.
   */
  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        type="date"
        className="min-w-0 flex-1"
        value={data}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-label={`${label} — data`}
        onChange={(evento) => emitir(evento.target.value, hora)}
      />
      <TimeSelect
        id={`${id}-hora`}
        label={label}
        value={hora}
        disabled={disabled}
        invalid={invalid}
        onChange={(novaHora) => emitir(data, novaHora)}
      />
    </div>
  );
}
