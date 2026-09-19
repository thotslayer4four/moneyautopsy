"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, m } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;
const ROTATE_INTERVAL_MS = 4000;

const QUIPS = [
  "Your statement is snitching.",
  "₦2k is never just ₦2k.",
  "Your money has been outside.",
  "Small small spending is still spending.",
  "“Send me ₦5k” adds up too.",
  "Your bank charges got their cut.",
  "Apparently, you like sending money.",
  "Your account has receipts.",
  "Your money didn't disappear. It left clues.",
  "One more ₦5k won't hurt. Right?",
  "Your data purchases are adding up.",
  "Your account has been very generous.",
  "You probably don't remember half of these.",
  "Your money has been busy doing side quests.",
  "“It's just this once” has entered the chat.",
  "Your statement remembers the ₦1,500 you forgot.",
  "Your biggest expense might surprise you.",
  "Your money has been changing hands.",
  "Somebody paid you back. We noticed.",
  "Your account has stories to tell.",
  "The little things have been keeping score.",
  "Your money has been outside without supervision.",
  "Your spending history is not as innocent as it looks.",
  "No judgment. Just receipts.",
  "This is about to get personal.",
  "Blood of Jesus.",
  "Sporty nearly kill you.",
  "You for build house with this money.",
  "Omo. Just omo.",
  "Alert came in. Alert went out.",
  "The owambe money has been located.",
  "Friday night has been located.",
  "Let's see who you've been blessing.",
  "The “I'll pay you back” money is still out there.",
  "Oga, we're still counting.",
  "Salary came. Salary went. Story.",
  "Small chops, big total.",
  "Even ₦100 has a story.",
  "Your account has seen things.",
  "Somebody's birthday cost you more than planned.",
];

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const subscribe = () => () => {};

/** A shuffled, rotating line of copy for loading screens. Decorative, so hidden from assistive tech. */
export function LoadingQuips() {
  // The shuffle is random, so nothing renders until mounted to keep server and client markup equal.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const [order] = useState(() => shuffle(QUIPS));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % order.length), ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [order.length]);

  return (
    <div aria-hidden className="flex min-h-12 max-w-sm items-start justify-center">
      <AnimatePresence mode="wait">
        {mounted && (
          <m.p
            key={index}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="text-balance text-sm leading-6 text-foreground-muted"
          >
            {order[index]}
          </m.p>
        )}
      </AnimatePresence>
    </div>
  );
}
