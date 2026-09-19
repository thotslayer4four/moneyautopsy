import { ShieldCheck } from "lucide-react";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

// A server component on purpose: the headline is in the first HTML and paints straight away.
// The entrance is CSS (see globals.css), so nothing waits on JavaScript to become visible.
export function Hero() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-24">
      <Container size="narrow">
        <div className="flex animate-rise flex-col items-center gap-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
              What actually happened to your money?
            </h1>
            <p className="max-w-lg animate-rise-1 text-balance text-lg leading-8 text-foreground-secondary">
              Upload a bank statement and we&apos;ll show you where your money went, what you&apos;re overlooking, and
              what you could change.
            </p>
          </div>

          <div className="flex animate-rise-2 flex-col items-center gap-3">
            <Button href="/about-you" size="lg" arrow glow>
              Start my autopsy
            </Button>
            <p className="text-xs text-foreground-muted">Takes about 2 minutes</p>
          </div>

          <div className="w-full max-w-md animate-rise-3">
            <Callout
              leadIn="We never store your statement."
              icon={<ShieldCheck size={20} className="shrink-0 text-accent" aria-hidden />}
              className="text-left"
            >
              We do autopsies, not archives. It&apos;s read once, then dropped, and you keep the original.
            </Callout>
          </div>
        </div>
      </Container>
    </div>
  );
}
