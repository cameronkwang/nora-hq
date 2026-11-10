import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { allowedUsers, checkPassword, getUser } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

export const metadata = { title: "Sign in" };

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const user = allowedUsers().find((u) => u.email === email);
  if (!user || !checkPassword(password)) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  if (await getUser()) redirect("/");
  const { error, next } = await searchParams;
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
        {error && <p className="mt-3 text-sm text-danger">That email and password don&apos;t match.</p>}
        {dev && <p className="mt-3 text-xs text-muted">Local dev: cameron@local or nora@local, password “dev”.</p>}
        <button className="mt-5 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90">Sign in</button>
      </form>
    </main>
  );
}
