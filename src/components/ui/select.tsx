"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value className={cn("flex-1 truncate text-left", className)} {...props} />;
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex min-h-12 w-fit items-center justify-between gap-2 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-foreground-secondary transition-colors duration-200 select-none hover:bg-foreground/[0.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 data-placeholder:text-foreground-secondary",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDown size={16} className="shrink-0 text-foreground-muted" aria-hidden />} />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 8,
  align = "end",
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignItemWithTrigger={false}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          className={cn(
            "max-h-(--available-height) min-w-48 origin-(--transform-origin) overflow-y-auto rounded-2xl border border-border-strong bg-surface-raised p-2 text-foreground shadow-lg shadow-black/5 duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-12 w-full cursor-default items-center rounded-xl py-2 pr-12 pl-4 text-sm text-foreground-secondary outline-none select-none data-disabled:opacity-40 data-highlighted:bg-foreground/[0.04] data-highlighted:text-foreground",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={<span className="absolute right-4 flex items-center text-accent" />}
      >
        <Check size={16} aria-hidden />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
