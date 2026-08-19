"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Os controles do formulário público.
 *
 * ⚠️ Não reutilizam `src/components/ui/input.tsx` de propósito. O CRM é uma
 * ferramenta usada no computador o dia inteiro, com altura de 36px e texto
 * pequeno; esta página é preenchida uma vez, no celular, muitas vezes no campo.
 * Daí `h-11` e `text-base`: abaixo de 16px o Safari do iPhone DÁ ZOOM ao focar
 * um campo, e a pessoa perde o formulário de vista no meio do preenchimento.
 *
 * O que os dois compartilham são os TOKENS de cor — e é por isso que estes
 * controles ficam vermelhos aqui dentro sem uma linha de cor escrita à mão.
 */

const controlClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-base text-foreground transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60 aria-[invalid=true]:border-destructive";

export function FieldShell({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-foreground block text-sm font-medium">
        {label}
        {optional && <span className="text-muted-foreground ml-1 font-normal">(opcional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-destructive text-xs font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, hint, error, optional, className, ...props },
  ref,
) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClass, className)}
        {...props}
      />
    </FieldShell>
  );
});

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean | undefined;
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { id, label, hint, error, optional, className, children, ...props },
  ref,
) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional}>
      <select
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClass, "appearance-none pr-8", className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export function CheckboxRow({
  id,
  checked,
  onChange,
  children,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  error?: string | undefined;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(evento) => onChange(evento.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-1 size-5 shrink-0 cursor-pointer accent-[var(--primary)]"
        />
        <label htmlFor={id} className="text-foreground cursor-pointer text-sm leading-relaxed">
          {children}
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-destructive text-xs font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Seleção múltipla em forma de etiqueta.
 *
 * `aria-pressed` num `<button>`, e não um checkbox escondido: o leitor de tela
 * anuncia "pressionado/não pressionado", que é exatamente o estado, e a área de
 * toque tem 44px de altura mínima — o alvo que o dedo alcança sem errar.
 */
export function ToggleChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-lg border px-4 py-2.5 text-left text-sm transition-[background-color,border-color,transform] duration-150 active:scale-[0.99]",
        pressed
          ? "border-primary bg-accent text-accent-foreground font-medium"
          : "border-hairline bg-card text-foreground hover:border-input",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "flex size-4 items-center justify-center rounded-[4px] border",
            pressed ? "border-primary bg-primary text-primary-foreground" : "border-input",
          )}
        >
          {pressed && (
            <svg
              viewBox="0 0 12 12"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M2.5 6.5 5 9l4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        {children}
      </span>
    </button>
  );
}
