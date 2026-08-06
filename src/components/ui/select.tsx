import { type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

/**
 * `<select>` nativo com o mesmo visual e os mesmos estados do `Input`.
 * Nativo de propósito: acessibilidade e teclado saem de graça, e o projeto
 * ainda não precisa de combobox com busca.
 */
export function Select({ className, ...props }: ComponentPropsWithRef<"select">) {
  return (
    <select
      className={cn(
        "border-border bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}
