import { type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn(
        "border-border bg-card text-card-foreground rounded-lg border shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentPropsWithRef<"div">) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentPropsWithRef<"h3">) {
  return <h3 className={cn("leading-none font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentPropsWithRef<"p">) {
  return <p className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithRef<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithRef<"div">) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
