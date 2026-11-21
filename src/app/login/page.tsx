import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { allowedUsers, checkPassword, getUser } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";
import { checkLogin, clearFailedLogins, recordFailedLogin } from "@/lib/login-guard";
import { signInPassword } from "@/lib/password-check";
import { buttonClass, cx } from "@/components/ui";

export const metadata = { title: "Sign in" };

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const guard = await checkLogin(email);
  if (guard.locked) redirect(`/login?locked=${guard.minutes}&next=${encodeURIComponent(next)}`);
  const user = allowedUsers().find((u) => u.email === email);
  if (!user || !checkPassword(password)) {
    await recordFailedLogin(guard.ipHash, email);
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  await clearFailedLogins(guard.ipHash);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(safeNext(next));
}

/** Same-origin path only. Parsing against a dummy origin catches "//host", "/\host", tabs/newlines and the like. */
function safeNext(next: string): string {
  if (!next.startsWith("/") || /[\\\u0000-\u001f]/.test(next)) return "/";
  try {
    const u = new URL(next, "http://x");
    return u.origin === "http://x" ? `${u.pathname}${u.search}${u.hash}` : "/";
  } catch {
    return "/";
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; locked?: string }> }) {
  if (await getUser()) redirect("/");
  const { error, next, locked } = await searchParams;
  const lockedMin = locked && /^\d{1,3}$/.test(locked) ? Number(locked) : null;
  const dev = process.env.NODE_ENV !== "production" && !process.env.APP_PASSWORD;
  // The live app with no APP_PASSWORD set: nobody can sign in, so say why instead of "don't match".
  const off = !signInPassword();
  return (
    <main className="ps-login">
      <form action={login} className="w-full max-w-sm">
        <h1 className="display">Nora HQ</h1>
        <p className="sub">Private. Sign in to continue.</p>
        <input type="hidden" name="next" value={next ?? "/"} />
        <div className="mt-8 space-y-5">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
        </div>
        {off ? (
          <p role="alert" className="status is-danger mt-5 flex whitespace-normal">Sign-in is switched off: the APP_PASSWORD setting is missing in Vercel.</p>
        ) : lockedMin ? (
          <p role="alert" className="status is-danger mt-5 flex whitespace-normal">Too many tries. Please wait about {lockedMin} minute{lockedMin === 1 ? "" : "s"} and try again.</p>
        ) : error ? (
          <p role="alert" className="status is-danger mt-5 flex whitespace-normal">That email and password don&apos;t match.</p>
        ) : null}
        {dev && <p className="meta mt-5">Local dev: cameron@local or nora@local, password “dev”.</p>}
        <button className={cx(buttonClass("primary"), "mt-6 w-full")}>Sign in</button>
      </form>
    </main>
  );
}
