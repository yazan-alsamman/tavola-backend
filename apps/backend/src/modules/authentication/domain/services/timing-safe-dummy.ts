/**
 * Argon2id hash of password "Aa1!NotARealUser" (m=4096, t=1, p=1).
 *
 * Shared fixed dummy credential used to equalize response timing when a
 * lookup keyed by a user-supplied identifier (email) finds no match, so an
 * attacker cannot distinguish "no such account" from "found, but rejected"
 * by measuring wall-clock time. `LoginUseCase` verifies the real submitted
 * password against this hash when the email is unknown; `ForgotPasswordUseCase`
 * verifies this fixed dummy password against this fixed hash, since it has no
 * user-submitted password to compare.
 */
export const TIMING_SAFE_DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=4096,t=1,p=1$loCXxymqsLv9ToaykZHuzA$ofherXK65CcCtssNfFh4Q33tvx4HOV1CNxGwL/h35w0';

export const TIMING_SAFE_DUMMY_PASSWORD = 'Aa1!NotARealUser';
