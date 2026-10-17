import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "li";
  padding?: "sm" | "md" | "lg";
  children: ReactNode;
};

const paddingClasses = {
  sm: "p-3",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6",
} as const;

export function Card({
  as: Tag = "div",
  padding = "md",
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-lj-lg border border-border bg-surface shadow-surface",
        paddingClasses[padding],
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
