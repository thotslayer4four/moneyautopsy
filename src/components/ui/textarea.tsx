import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-2xl border border-border-strong bg-surface px-6 py-4 text-base leading-7 text-foreground transition-colors duration-200 placeholder:text-foreground-muted hover:border-foreground-muted disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    />
  );
}
