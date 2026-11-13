/** ADR-053: free period every new branch starts with. */
export const BRANCH_TRIAL_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export function trialEndFor(createdAt: Date): Date {
  return new Date(createdAt.getTime() + BRANCH_TRIAL_DAYS * MS_PER_DAY);
}
