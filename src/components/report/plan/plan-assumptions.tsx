import { ChevronDown } from "lucide-react";

/** The working behind the plan, tucked away: there for anyone who wants to check it. */
export function PlanAssumptions({ assumptions }: { assumptions: string[] }) {
  if (assumptions.length === 0) return null;
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground-secondary [&::-webkit-details-marker]:hidden">
        How we built this plan
        <ChevronDown size={16} className="shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="flex flex-col gap-3 pt-2">
        {assumptions.map((a, i) => (
          <li key={i} className="max-w-prose text-sm leading-6 text-foreground-muted">
            {a}
          </li>
        ))}
      </ul>
    </details>
  );
}
