/**
 * Built-in sign-in settings (production). These replace the Vercel APP_PASSWORD variable, which can't be
 * edited from Claude's side. The password is stored only as a salted scrypt hash — never in plain text.
 * To change it: generate a new hash (see docs/setup.md "Changing the sign-in password") and replace PASSWORD_HASH.
 * APP_USERS in Vercel still works and is merged with TEAM.
 */
export const TEAM: ReadonlyArray<{ name: string; email: string }> = [
  { name: "Cameron", email: "cameron.k.wang@gmail.com" },
  { name: "Nora", email: "norachen.2019@gmail.com" },
];

export const PASSWORD_HASH = "scrypt:+J69ujrqmGZWm1V/E6dmrw==:5gUSlykjyKmnCuLwjyYj4lX5h4wXr7prOg5b48DUK1VAhqPPMNH1yfOsWSy817lQLBWNhR1Tv41JEIRO3CemWw==";
