import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-4 [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary-soft text-primary-soft-foreground",
        secondary: "bg-secondary text-muted-foreground",
        outline: "border border-border text-muted-foreground",
        warning:
          "bg-warning/15 text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))]",
        success:
          "bg-success/15 text-[color-mix(in_oklch,var(--success)_75%,var(--foreground))]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
