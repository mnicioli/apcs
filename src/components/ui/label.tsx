import { type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentPropsWithRef<"label">) {
  return (
    <label
      className={cn(
        "text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}
