import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Label({ className, ...props }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex select-none items-center gap-2 text-[13px] font-medium leading-none text-foreground peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
