"use client";

import { LazyMotion, MotionConfig } from "framer-motion";

// The animation engine loads after first paint instead of blocking it, and only the parts we use
// (animation, hover/tap, in-view) are included: a much smaller download on a phone.
const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures}>
      {/* "user" turns off movement for anyone who has asked their device for reduced motion. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
