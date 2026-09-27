import { cn } from "@/lib/utils";
import { Label } from "./label";

// A label + control + optional hint, stacked with consistent spacing.
function Field({ label, hint, htmlFor, optional, className, children }) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground">Optional</span>
        )}
      </Label>
      {children}
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export { Field };
