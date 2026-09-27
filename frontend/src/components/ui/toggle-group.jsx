import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function ToggleGroup({ className, ...props }) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn("inline-flex items-center rounded-md bg-secondary p-0.5", className)}
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[6px] px-2 text-sm text-muted-foreground transition-[color,background-color,box-shadow] outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
