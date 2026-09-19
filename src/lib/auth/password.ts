/**
 * The new-password rules -- thin re-export.
 *
 * The rules moved to `packages/upkeep-domain/src/password.ts` so the mobile app
 * validates against the same floor instead of a hand-kept copy. This file
 * stays so signup, recovery, settings and `scripts/password.test.ts` keep
 * importing from `@/lib/auth/password` unchanged. The reasoning for the
 * length lives in the shared module's header.
 */

export {
  MIN_PASSWORD_LENGTH,
  validateNewPassword,
  validateUsername,
  type PasswordCheck,
} from "@upkeep/domain";
