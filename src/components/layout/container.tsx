import { cn } from "@/lib/utils";

const SIZES = {
  narrow: "max-w-2xl",
  default: "max-w-4xl",
  wide: "max-w-6xl",
} as const;

export function Container({
  className,
  children,
  size = "default",
}: {
  className?: string;
  children: React.ReactNode;
  size?: keyof typeof SIZES;
}) {
  return <div className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", SIZES[size], className)}>{children}</div>;
}
