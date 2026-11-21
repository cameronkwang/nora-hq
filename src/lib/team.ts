/**
 * The two people who can always sign in (production). APP_USERS in Vercel still works and is merged with TEAM.
 * The sign-in password is NOT here and never will be: it is the APP_PASSWORD variable in Vercel
 * (docs/setup.md "Changing the sign-in password").
 */
export const TEAM: ReadonlyArray<{ name: string; email: string }> = [
  { name: "Cameron", email: "cameron.k.wang@gmail.com" },
  { name: "Nora", email: "norachen.2019@gmail.com" },
];
