import { type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

/** Campo de texto longo, com os mesmos estados visuais do `Input`. */
export function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea
      className={cn(
        "border-border bg-background flex w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors",
        "placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}
