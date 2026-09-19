import Link from "next/link";
import { LogoMark } from "@/components/brand/logo-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Container } from "./container";

export function SiteHeader() {
  return (
    <header className="w-full">
      <Container size="wide" className="flex items-center justify-between py-6 sm:py-8">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <LogoMark size={20} className="text-accent" />
          Money autopsy
        </Link>
        <ThemeToggle />
      </Container>
    </header>
  );
}
