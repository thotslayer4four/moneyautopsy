import { Hero } from "@/components/landing/hero";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/brand";
import { AUTOPSY_PRICE_NGN } from "@/lib/payments/pricing";

// Tells search engines what this is: a finance web app, and what the full report costs.
const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any",
  inLanguage: "en-NG",
  offers: { "@type": "Offer", price: String(AUTOPSY_PRICE_NGN), priceCurrency: "NGN" },
};

export default function LandingPage() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <script
        type="application/ld+json"
        // "<" is escaped so no field can ever close the script tag early.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <AmbientBackground />
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Hero />
      </main>
    </div>
  );
}

function AmbientBackground() {
  return (
    <div aria-hidden>
      <div className="pointer-events-none absolute left-1/2 top-[-10%] -z-10 h-[32rem] w-[48rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] -z-10 h-[24rem] w-[24rem] rounded-full bg-accent/[0.06] blur-3xl" />
    </div>
  );
}
