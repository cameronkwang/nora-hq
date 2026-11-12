import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { allowedUsers, checkPassword, getUser } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";
import { checkLogin, clearFailedLogins, recordFailedLogin } from "@/lib/login-guard";

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
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form action={login} className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold">Nora HQ</h1>
        <p className="mt-1 text-sm text-muted">Private. Sign in to continue.</p>
        <input type="hidden" name="next" value={next ?? "/"} />
        <div className="mt-5 space-y-3">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
        </div>
        {lockedMin ? (
          <p className="mt-3 text-sm text-danger">Too many tries. Please wait about {lockedMin} minute{lockedMin === 1 ? "" : "s"} and try again.</p>
        ) : error ? (
          <p className="mt-3 text-sm text-danger">That email and password don&apos;t match.</p>
        ) : null}
        {dev && <p className="mt-3 text-xs text-muted">Local dev: cameron@local or nora@local, password “dev”.</p>}
        <button className="mt-5 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90">Sign in</button>
      </form>
    </main>
  );
}
