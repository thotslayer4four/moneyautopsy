"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The field shell shared by every text-like input: same height, radius and border as an OptionCard. */
function Field({ prefix, className, ...props }: ComponentProps<"input"> & { prefix?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex min-h-12 w-full items-center gap-2 rounded-2xl border border-border-strong bg-surface px-6 transition-colors duration-200",
        "focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
        className
      )}
    >
      {prefix && (
        <span aria-hidden className="text-base font-medium text-foreground-muted">
          {prefix}
        </span>
      )}
      <input
        className="min-w-0 flex-1 bg-transparent py-4 text-base font-medium text-foreground outline-none placeholder:font-normal placeholder:text-foreground-muted"
        {...props}
      />
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "prefix"> & { value: string | undefined; onChange: (value: string) => void }) {
  return <Field type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...props} />;
}

/** A whole-naira amount, typed as digits and shown with thousands separators ("1,200,000").
 * Anything that isn't a digit (₦, commas, spaces) is dropped as it's typed. */
export function MoneyInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "prefix" | "type"> & {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <Field
      prefix="₦"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className="tabular-nums"
      value={value === undefined ? "" : value.toLocaleString("en-NG")}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
        onChange(digits ? Number(digits) : undefined);
      }}
      {...props}
    />
  );
}
