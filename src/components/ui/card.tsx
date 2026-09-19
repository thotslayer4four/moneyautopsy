import { cn } from "@/lib/utils";

/** Large hero / result card. */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl border border-border-strong bg-surface p-6 sm:p-8",
        className
      )}
      {...props}
    />
  );
}

/** Secondary card for findings, recommendations and grouped content. */
export function SecondaryCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border-strong bg-surface p-6 transition-shadow duration-200 hover:shadow-lg hover:shadow-black/5",
        className
      )}
      {...props}
    />
  );
}
