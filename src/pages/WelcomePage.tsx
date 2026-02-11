import { Link } from "react-router-dom";

export function WelcomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background-dark text-white">
      <div className="pointer-events-none absolute right-[-180px] top-[-180px] h-[520px] w-[520px] rounded-full bg-primary/10 blur-[100px]" />
      <div className="pointer-events-none absolute bottom-[-200px] left-[-120px] h-[520px] w-[520px] rounded-full bg-secondary-gold/10 blur-[120px]" />
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-4 py-10 sm:px-6 lg:grid lg:grid-cols-2 lg:gap-12 lg:px-8">
        <section className="space-y-7">
          <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            Live Season Open
          </span>
          <h1 className="text-5xl font-extrabold leading-tight md:text-6xl">
            Turn Job Hunting into a <span className="text-secondary-gold">Winning Streak</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-slate-300">
            Create a squad, connect Gmail, and stay accountable with weekly financial stakes.
            Hit the group goal to protect your goal-locked stake and climb the leaderboard.
          </p>
          <div className="grid grid-cols-2 gap-4 pt-4">
            <article className="rounded-xl border border-primary/10 bg-surface-dark p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Weekly Streak</p>
              <p className="mt-2 text-2xl font-bold">12 Days</p>
            </article>
            <article className="rounded-xl border border-primary/10 bg-surface-dark p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Pot Value</p>
              <p className="mt-2 text-2xl font-bold">$1,450</p>
            </article>
          </div>
        </section>

        <section className="mt-10 rounded-2xl border border-primary/15 bg-surface-dark p-8 shadow-2xl shadow-primary/10 lg:mt-0">
          <h2 className="text-2xl font-bold">Create your Challenger Profile</h2>
          <p className="mt-2 text-sm text-slate-400">Google and email sign-in are supported.</p>
          <div className="mt-8 space-y-3">
            <Link
              to="/auth/register"
              className="block w-full rounded-lg bg-primary px-4 py-3 text-center text-sm font-bold text-background-dark transition-colors hover:bg-primary-dark"
            >
              Start Competing
            </Link>
            <Link
              to="/auth/login"
              className="block w-full rounded-lg border border-primary/30 px-4 py-3 text-center text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              I already have an account
            </Link>
          </div>
          <div className="mt-8 border-t border-primary/10 pt-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-primary">Gameplay Loop</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              <li>1. Join a group and align on a weekly threshold.</li>
              <li>2. Contribute $14: $7 base + $7 goal-locked stake.</li>
              <li>3. Friday settlement redistributes lost goal-locked stake equally.</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
