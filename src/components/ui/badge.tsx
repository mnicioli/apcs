import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        /** Estado normal, sem urgência. */
        default: "bg-muted text-muted-foreground",
        /** Pede ação de alguém — é o único que usa a cor da marca. */
        attention: "bg-accent text-primary-strong",
        /** Encerrado, resolvido, sem pendência. */
        done: "border border-border text-muted-foreground",
        /** Algo saiu errado e precisa de olho humano. */
        alert: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends ComponentPropsWithRef<"span">, VariantProps<typeof badgeVariants> {}

/**
 * Selo de estado. Existe para a Central de Atendimento poder dizer, numa
 * varredura de olho, o que cada linha da fila exige — por isso os nomes das
 * variantes são de INTENÇÃO (`attention`, `alert`) e não de cor: se um dia a
 * urgência deixar de ser laranja, muda aqui e não em cada tela.
 */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
