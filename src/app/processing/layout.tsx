import type { Metadata } from "next";

// A private, per-person step: it has a proper title in the tab, but stays out of search results.
export const metadata: Metadata = {
  title: "Reading your statement",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
