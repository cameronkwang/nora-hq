/**
 * The sign-in password comes only from the APP_PASSWORD variable; nothing in the code can be used to sign in.
 * Run: npx tsx scripts/test-sign-in.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { passwordMatches, signInPassword } from "../src/lib/password-check";

// Production: only the variable counts, and there is no fallback.
assert.equal(signInPassword({ NODE_ENV: "production" }), "", "production with no variable: no password at all");
assert.equal(signInPassword({ NODE_ENV: "production", APP_PASSWORD: "   " }), "", "a blank variable is no password");
assert.equal(signInPassword({ NODE_ENV: "production", APP_PASSWORD: "four random sample words" }), "four random sample words");
assert.equal(signInPassword({ NODE_ENV: "production", APP_PASSWORD: " pasted with spaces \n" }), "pasted with spaces", "stray spaces from a paste are dropped");
// Local dev: "dev" unless a password is set.
assert.equal(signInPassword({ NODE_ENV: "development" }), "dev");
assert.equal(signInPassword({ NODE_ENV: "development", APP_PASSWORD: "" }), "dev");
assert.equal(signInPassword({ NODE_ENV: "development", APP_PASSWORD: "local one" }), "local one");

// Matching: exact, any length, and an empty expected password lets nobody in.
assert.equal(passwordMatches("four random sample words", "four random sample words"), true);
assert.equal(passwordMatches("four random sample word", "four random sample words"), false);
assert.equal(passwordMatches("Four random sample words", "four random sample words"), false);
assert.equal(passwordMatches("", "four random sample words"), false);
assert.equal(passwordMatches("", ""), false, "no password set: an empty try is refused");
assert.equal(passwordMatches("dev", ""), false, "no password set: the local default is refused");
assert.equal(passwordMatches("密码 one", "密码 one"), true);

// In production with nothing set, no try gets in: not the local default, not an empty box.
for (const guess of ["", "dev", "password", "undefined"]) {
  assert.equal(passwordMatches(guess, signInPassword({ NODE_ENV: "production" })), false, `"${guess}" must not sign in`);
}

// The code itself holds no password and no hash of one.
for (const file of ["src/lib/team.ts", "src/lib/auth.ts", "src/lib/password-check.ts"]) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.ok(!/scrypt:|PASSWORD_HASH/.test(text), `${file} holds no password hash`);
  assert.ok(!/[A-Za-z0-9+/]{60,}={0,2}/.test(text), `${file} holds no long encoded value`);
}

console.log("sign-in: all checks passed");
