import { LOGO_MARK_PATH } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** The Money autopsy mark. It takes its colour from the text colour, so it follows the theme. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="6 6 52 52"
      width={size}
      height={size}
      aria-hidden
      fill="currentColor"
      className={cn("shrink-0", className)}
    >
      <path d={LOGO_MARK_PATH} />
    </svg>
  );
}
