import { userProfileSchema } from "@/lib/profileSchema";
import type { UserProfile } from "@/lib/types";

/** True when About You is fully answered, including any follow-up a previous answer required. */
export function isProfileComplete(profile: Partial<UserProfile>): boolean {
  return userProfileSchema.safeParse(profile).success;
}
