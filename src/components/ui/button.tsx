"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { m, type HTMLMotionProps } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const MotionLink = m.create(Link);

const buttonVariants = cva(
  "inline-flex min-h-12 items-center justify-center rounded-full font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-foreground text-background hover:bg-foreground/85",
        secondary:
          "border border-border-strong bg-surface text-foreground hover:bg-foreground/[0.04]",
        ghost: "text-foreground-secondary hover:bg-foreground/[0.04] hover:text-foreground",
      },
      size: {
        md: "gap-2 px-6 py-3 text-sm",
        lg: "gap-3 px-8 py-4 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

type ButtonProps = Omit<HTMLMotionProps<"button">, "ref"> &
  VariantProps<typeof buttonVariants> & {
    /** Renders a link instead of a button. */
    href?: string;
    /** Trailing arrow icon. */
    arrow?: boolean;
    /** Soft accent glow, for primary calls to action. */
    glow?: boolean;
  };

const tap = { scale: 0.97 };
const tapTransition = { duration: 0.15 };

export function Button({
  variant,
  size,
  href,
  arrow = false,
  glow = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), glow && "shadow-lg shadow-accent/10", className);
  const content = (
    <>
      {children}
      {arrow && <ArrowRight size={18} aria-hidden />}
    </>
  );

  if (href) {
    return (
      <MotionLink href={href} className={classes} whileTap={tap} transition={tapTransition}>
        {content}
      </MotionLink>
    );
  }

  return (
    <m.button
      type="button"
      disabled={disabled}
      className={classes}
      whileTap={disabled ? undefined : tap}
      transition={tapTransition}
      {...props}
    >
      {content}
    </m.button>
  );
}
