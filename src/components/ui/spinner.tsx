import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ size = 22, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} aria-hidden className={cn("animate-spin text-accent", className)} />;
}
