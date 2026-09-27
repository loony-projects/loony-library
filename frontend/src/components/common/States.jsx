import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-16 text-center sm:py-20",
        className,
      )}
    >
      {Icon && (
        <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="size-5" />
        </div>
      )}
      <h3 className="font-serif text-2xl font-medium tracking-tight">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-[15px] text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry, className }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-16 text-center", className)}>
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-destructive-soft text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="font-serif text-2xl font-medium tracking-tight">{title}</h3>
      {message && <p className="mt-2 max-w-md text-[15px] text-muted-foreground">{message}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineMessage({ tone = "status", children, className }) {
  if (!children) return null;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md px-3 py-2 text-sm",
        tone === "error"
          ? "bg-destructive-soft text-destructive"
          : "bg-success/12 text-[color-mix(in_oklch,var(--success)_75%,var(--foreground))]",
        className,
      )}
    >
      {children}
    </p>
  );
}
