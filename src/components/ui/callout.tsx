import { cn } from "@/lib/utils";

export function Callout({
  leadIn,
  icon,
  children,
  className,
}: {
  leadIn?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl bg-accent-wash px-6 py-4", className)}>
      {icon}
      <p className="text-sm leading-6 text-foreground-secondary">
        {leadIn && <span className="font-semibold text-foreground">{leadIn} </span>}
        {children}
      </p>
    </div>
  );
}
