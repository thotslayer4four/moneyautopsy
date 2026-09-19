/** Short numbered steps — the same shape as the rest of the report, used for rules and the reset. */
export function NumberedList({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((item, i) => (
        <li key={i} className="flex max-w-prose items-start gap-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-wash text-xs font-medium tabular-nums text-foreground">
            {i + 1}
          </span>
          <p className="pt-1 text-base leading-6 text-foreground-secondary">{item}</p>
        </li>
      ))}
    </ol>
  );
}
