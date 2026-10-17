import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type AlertVariant = "error" | "success" | "warning" | "info";

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
};

const variantClasses: Record<AlertVariant, string> = {
  error: "border-danger-100 bg-danger-50 text-danger-800",
  success: "border-brand-200 bg-success-50 text-success-700",
  warning: "border-accent-100 bg-accent-50 text-accent-800",
  info: "border-brand-100 bg-brand-50 text-brand-800",
};

const variantLabels: Record<AlertVariant, string> = {
  error: "Error",
  success: "Correcto",
  warning: "Atención",
  info: "Información",
};

export function Alert({
  variant = "info",
  title,
  children,
  className,
  role,
  ...props
}: AlertProps) {
  const resolvedRole =
    role ?? (variant === "error" || variant === "warning" ? "alert" : "status");

  return (
    <div
      role={resolvedRole}
      className={cn(
        "rounded-lj-md border px-3 py-2.5 text-sm font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      <p className="font-semibold">
        {title ?? variantLabels[variant]}
      </p>
      <div className="mt-0.5 font-medium">{children}</div>
    </div>
  );
}
