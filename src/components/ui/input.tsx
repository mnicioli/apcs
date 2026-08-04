import { type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: ComponentPropsWithRef<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "border-border bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors",
        "placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}
