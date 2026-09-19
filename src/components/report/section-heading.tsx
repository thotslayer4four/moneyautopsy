/** A section is a plain title and, where it helps, one line on what the section shows. */
export function ReportSection({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        {description && <p className="max-w-prose text-base leading-7 text-foreground-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}
