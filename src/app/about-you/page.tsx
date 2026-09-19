"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import {
  ArrowLeft,
  Banknote,
  Briefcase,
  Cake,
  Coins,
  Handshake,
  HandCoins,
  HandHeart,
  House,
  Receipt,
  ScanSearch,
  Sparkles,
  Star,
  Target,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Container } from "@/components/layout/container";
import { SiteHeader } from "@/components/layout/site-header";
import { OptionCard } from "@/components/onboarding/option-card";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { ProgressBar } from "@/components/ui/progress";
import { useAutopsyStore } from "@/lib/store";
import { sentenceCase } from "@/lib/format";
import type { UserProfile } from "@/lib/types";
import { Callout } from "@/components/ui/callout";
import { userProfileSchema } from "@/lib/profileSchema";
import { firstUnansweredIndex, isStepAnswered, steps, type ChoiceStep, type MultiStep, type Option } from "./steps";

const EASE = [0.22, 1, 0.36, 1] as const;

const STEP_ICONS: Record<string, LucideIcon> = {
  gender: User,
  ageRange: Cake,
  situation: Briefcase,
  livingWith: House,
  incomeSources: Wallet,
  primaryIncomeSource: Star,
  income: Banknote,
  goal: Target,
  expensesCovered: Receipt,
  supports: HandHeart,
  borrowing: HandCoins,
  borrowingAmount: HandCoins,
  lending: Handshake,
  lendingAmount: Handshake,
  paysForOthers: Users,
  withdrawsCash: Banknote,
  cashMonthly: Coins,
  perceivedOverspending: ScanSearch,
};
const ADVANCE_DELAY_MS = 200;
const MAX_KEY_HINTS = 9;

type Patch = (update: Partial<Record<keyof UserProfile, unknown>>) => void;

export default function AboutYouPage() {
  const router = useRouter();
  const profile = useAutopsyStore((s) => s.profile);
  const setProfile = useAutopsyStore((s) => s.setProfile);
  const [stepIndex, setStepIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const advanceTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  // Steps can drop out depending on earlier answers (no "primary source" question when only
  // one source was picked), so progress is measured over what is actually shown.
  const visibleSteps = steps.filter((s) => !s.skip?.(profile));
  const index = Math.min(stepIndex, visibleSteps.length - 1);
  const step = visibleSteps[index];
  const isLast = index === visibleSteps.length - 1;

  const patch: Patch = (update) => setProfile(update as Partial<UserProfile>);

  function goNext() {
    setNotice(null);
    if (!isLast) {
      setStepIndex(index + 1);
      return;
    }

    // Finishing: check the answers as they are NOW (this can run from a timer, after the
    // last answer was stored) instead of sending someone to /upload just to be bounced back.
    const answers = useAutopsyStore.getState().profile;
    const missing = firstUnansweredIndex(answers);
    if (missing !== -1) {
      setStepIndex(missing);
      setNotice("One question still needs an answer before we can continue.");
      return;
    }
    const parsed = userProfileSchema.safeParse(answers);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join(".") ?? "unknown";
      console.error("About You answers failed validation:", parsed.error.issues);
      setNotice(`Something in your answers didn't validate (${field}). Go back and re-select it.`);
      return;
    }
    router.push("/upload");
  }

  function goBack() {
    if (index === 0) {
      router.push("/");
      return;
    }
    setStepIndex(index - 1);
  }

  function advanceSoon() {
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(goNext, ADVANCE_DELAY_MS);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center py-12">
        <Container size="narrow" className="flex flex-col gap-8">
          <ProgressBar
            label={`Question ${index + 1} of ${visibleSteps.length}`}
            value={((index + 1) / visibleSteps.length) * 100}
            showValue
          />

          <AnimatePresence mode="wait">
            <m.div
              key={step.key}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex flex-col gap-8"
            >
              {notice && (
                <div role="alert">
                  <Callout>{notice}</Callout>
                </div>
              )}
              <div className="flex flex-col gap-4">
                <IconTile icon={STEP_ICONS[step.key] ?? Sparkles} />
                <div className="flex flex-col gap-2">
                  <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{step.question}</h1>
                  {step.helper && <p className="text-base text-foreground-secondary">{step.helper}</p>}
                </div>
              </div>

              {step.type === "choice" ? (
                <ChoiceQuestion
                  step={step}
                  profile={profile}
                  onPatch={patch}
                  onAdvance={advanceSoon}
                  isLast={isLast}
                  onFinish={goNext}
                />
              ) : (
                <MultiQuestion step={step} profile={profile} onPatch={patch} onContinue={goNext} />
              )}
            </m.div>
          </AnimatePresence>

          <Button variant="ghost" onClick={goBack} className="self-start">
            <ArrowLeft size={18} aria-hidden />
            Back
          </Button>
        </Container>
      </main>
    </div>
  );
}

function OptionGrid({
  options,
  isSelected,
  onSelect,
}: {
  options: readonly Option[];
  isSelected: (value: string) => boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((opt, i) => (
        <OptionCard
          key={opt.value}
          label={sentenceCase(opt.label)}
          hint={i < MAX_KEY_HINTS ? String(i + 1) : undefined}
          selected={isSelected(opt.value)}
          onClick={() => onSelect(opt.value)}
        />
      ))}
    </div>
  );
}

/** Number keys pick the matching option, so most of onboarding can be done from the keyboard. */
function useNumberKeys(options: readonly Option[], onPick: (value: string) => void) {
  const latest = useRef({ options, onPick });
  useEffect(() => {
    latest.current = { options, onPick };
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const option = latest.current.options[Number(e.key) - 1];
      if (option) latest.current.onPick(option.value);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function ChoiceQuestion({
  step,
  profile,
  onPatch,
  onAdvance,
  isLast,
  onFinish,
}: {
  step: ChoiceStep;
  profile: Partial<UserProfile>;
  onPatch: Patch;
  onAdvance: () => void;
  /** On the final question, answering doesn't auto-advance: an explicit button finishes. */
  isLast: boolean;
  onFinish: () => void;
}) {
  const options = step.dynamicOptions ? step.dynamicOptions(profile) : step.options;
  const current = profile[step.key] as string | undefined;
  const { followUp } = step;
  const showingFollowUp = !!followUp && !!current && followUp.showWhen.includes(current);

  function select(value: string) {
    onPatch({ [step.key]: value });
    if (!followUp) {
      if (!isLast) onAdvance();
      return;
    }
    if (followUp.showWhen.includes(value)) return; // stay on this screen: the follow-up is next
    onPatch({ [followUp.key]: undefined });
    if (!isLast) onAdvance();
  }

  function selectFollowUp(value: string) {
    if (!followUp) return;
    onPatch({ [followUp.key]: value });
    if (!isLast) onAdvance();
  }

  useNumberKeys(showingFollowUp && followUp ? followUp.options : options, showingFollowUp ? selectFollowUp : select);

  return (
    <div className="flex flex-col gap-8">
      <OptionGrid options={options} isSelected={(v) => current === v} onSelect={select} />

      {followUp && showingFollowUp && (
        <m.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="flex flex-col gap-4"
        >
          <h2 className="text-balance text-xl font-semibold tracking-tight">{followUp.question}</h2>
          <OptionGrid options={followUp.options} isSelected={(v) => profile[followUp.key] === v} onSelect={selectFollowUp} />
        </m.div>
      )}

      {isLast && (
        <Button size="lg" arrow glow className="self-start" disabled={!isStepAnswered(step, profile)} onClick={onFinish}>
          Continue
        </Button>
      )}
    </div>
  );
}

function MultiQuestion({
  step,
  profile,
  onPatch,
  onContinue,
}: {
  step: MultiStep;
  profile: Partial<UserProfile>;
  onPatch: Patch;
  onContinue: () => void;
}) {
  const selected = (profile[step.key] as string[] | undefined) ?? [];
  const exclusive = step.exclusive ?? [];

  function toggle(value: string) {
    let next: string[];
    if (selected.includes(value)) {
      next = selected.filter((v) => v !== value);
    } else if (exclusive.includes(value)) {
      next = [value];
    } else {
      next = [...selected.filter((v) => !exclusive.includes(v)), value];
    }
    onPatch({ [step.key]: next });
  }

  function handleContinue() {
    if (step.key === "incomeSources") {
      // Keep the "primary source" answer consistent with what's now selected.
      const primary = profile.primaryIncomeSource;
      if (selected.length === 1) onPatch({ primaryIncomeSource: selected[0] });
      else if (primary && !selected.includes(primary)) onPatch({ primaryIncomeSource: undefined });
    }
    onContinue();
  }

  useNumberKeys(step.options, toggle);

  return (
    <div className="flex flex-col gap-8">
      <OptionGrid options={step.options} isSelected={(v) => selected.includes(v)} onSelect={toggle} />
      <Button size="lg" arrow glow className="self-start" disabled={selected.length === 0} onClick={handleContinue}>
        Continue
      </Button>
    </div>
  );
}
