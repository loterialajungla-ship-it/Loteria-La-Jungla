import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { cn } from "@/components/ui/cn";

export type ErrorStateProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

export function ErrorState({
  title = "No se pudo completar la operación",
  children,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn(className)}>
      <Alert variant="error" title={title}>
        {children}
      </Alert>
    </div>
  );
}
