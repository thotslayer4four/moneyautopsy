"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ClientReport, UserProfile } from "@/lib/types";

const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

interface AutopsyState {
  profile: Partial<UserProfile>;
  setProfile: (patch: Partial<UserProfile>) => void;
  reportId: string | null;
  setReportId: (id: string | null) => void;
  pendingFile: File | null;
  setPendingFile: (file: File | null) => void;
  report: ClientReport | null;
  setReport: (report: ClientReport | null) => void;
  reset: () => void;
}

export const useAutopsyStore = create<AutopsyState>()(
  persist(
    (set) => ({
      profile: {},
      setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      reportId: null,
      setReportId: (id) => set({ reportId: id }),
      pendingFile: null,
      setPendingFile: (file) => set({ pendingFile: file }),
      report: null,
      setReport: (report) => set({ report }),
      reset: () => set({ profile: {}, reportId: null, pendingFile: null, report: null }),
    }),
    {
      name: "money-autopsy-session",
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : sessionStorage)),
      // File objects can't be serialized, and don't need to survive a refresh.
      partialize: (state) => ({ profile: state.profile, reportId: state.reportId }),
    }
  )
);

/** True once the persisted (sessionStorage) slice of the store has been read back in.
 * Needed before trusting `profile`/`reportId` on first render — otherwise a page that
 * redirects based on missing data will bounce the user before rehydration finishes. */
export function useStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useAutopsyStore.persist?.hasHydrated?.() ?? true);

  useEffect(() => {
    if (!useAutopsyStore.persist) return;
    return useAutopsyStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}
