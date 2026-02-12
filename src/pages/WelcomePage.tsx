import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../app/AuthContext";

type AuthMode = "signup" | "login";

const signUpView = "signup";
const loginView = "login";
const privacyPolicyHref = "/Privacy.pdf";
const termsOfUseHref = "/Terms.pdf";

function normalizeAuthMode(value: string | null): AuthMode {
  return value === loginView ? loginView : signUpView;
}

function updateModeSearchParams(current: URLSearchParams, mode: AuthMode): URLSearchParams {
  const next = new URLSearchParams(current);
  if (mode === loginView) {
    next.set("mode", loginView);
    return next;
  }
  next.delete("mode");
  return next;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStrongPassword(value: string): boolean {
  const hasUppercase = /[A-Z]/.test(value);
  const hasLowercase = /[a-z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(value);
  return value.length >= 8 && hasUppercase && hasLowercase && hasNumber && hasSymbol;
}

function isInvalidCredentialMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("invalid credentials") ||
    normalized.includes("no account found") ||
    normalized.includes("incorrect password") ||
    normalized.includes("wrong email or password") ||
    normalized.includes("status 401")
  );
}

export function WelcomePage() {
  const {
    loading,
    registerWithEmail,
    signInWithGoogle,
    signInWithPassword,
    signUpWithGoogle
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const modeFromQuery = useMemo(() => normalizeAuthMode(searchParams.get("mode")), [searchParams]);
  const [authMode, setAuthMode] = useState<AuthMode>(modeFromQuery);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [validationBounce, setValidationBounce] = useState(0);

  const from = (location.state as { from?: string } | null)?.from ?? "/my-groups";
  const isLoginMode = authMode === loginView;
  const passwordType = passwordVisible ? "text" : "password";

  useEffect(() => {
    setAuthMode(modeFromQuery);
  }, [modeFromQuery]);

  useEffect(() => {
    if (searchParams.get("oauthError") !== "1") {
      return;
    }
    setError(searchParams.get("message") ?? "Unable to continue with Google.");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("oauthError");
    nextParams.delete("message");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const toggleMode = (nextMode: AuthMode) => {
    if (nextMode === authMode) {
      return;
    }
    setError(null);
    setNotice(null);
    setValidationMessage(null);
    setAuthMode(nextMode);
    setSearchParams(updateModeSearchParams(searchParams, nextMode), { replace: true });
  };

  const showValidationMessage = (message: string) => {
    setValidationMessage(message);
    setValidationBounce((count) => count + 1);
  };

  const submitSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setValidationMessage(null);

    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim()) {
      showValidationMessage("Please fill out the field.");
      return;
    }

    if (!isValidEmail(email.trim())) {
      showValidationMessage("Please enter a valid email address.");
      return;
    }

    if (!isStrongPassword(password)) {
      showValidationMessage(
        "Use a stronger password with 8+ characters, uppercase, lowercase, a number, and a symbol."
      );
      return;
    }

    if (!termsAccepted) {
      showValidationMessage("Please accept Terms and Privacy Policy.");
      return;
    }

    try {
      await registerWithEmail({ firstName, lastName, email, password });
      navigate(from, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to register.");
    }
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setValidationMessage(null);

    if (!email.trim() || !password.trim()) {
      showValidationMessage("Please fill out the field.");
      return;
    }

    if (!isValidEmail(email.trim())) {
      showValidationMessage("Please enter a valid email address.");
      return;
    }

    try {
      await signInWithPassword(email, password);
      navigate(from, { replace: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to sign in.";
      if (isInvalidCredentialMessage(message)) {
        showValidationMessage("Wrong Email or password");
        return;
      }
      setError(message);
    }
  };

  const continueWithGoogle = async () => {
    setError(null);
    setNotice(null);
    setValidationMessage(null);
    try {
      if (isLoginMode) {
        await signInWithGoogle(email);
      } else {
        await signUpWithGoogle(email);
      }
      navigate(from, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to continue with Google.");
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden bg-background-dark text-white">
      <header className="welcome-glass-card fixed inset-x-0 top-0 z-50 border-b border-primary/10">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-background-dark">
              <span className="material-icons text-xl">offline_bolt</span>
            </div>
            <span className="text-xl font-bold tracking-tight text-white">IncentApply</span>
          </div>
          <div className="hidden items-center space-x-8 md:flex">
            <button
              type="button"
              className="text-sm font-medium text-gray-300 transition-colors hover:text-primary"
            >
              How it works
            </button>
            <button
              type="button"
              className="text-sm font-medium text-gray-300 transition-colors hover:text-primary"
            >
              Pricing
            </button>
            <div className="h-4 w-px bg-gray-700" />
            <button
              type="button"
              onClick={() => toggleMode(isLoginMode ? signUpView : loginView)}
              className="text-sm font-medium text-white transition-colors hover:text-primary"
            >
              {isLoginMode ? "Sign up" : "Log in"}
            </button>
          </div>
          <button
            type="button"
            className="p-2 text-gray-300 transition-colors hover:text-white focus:outline-none md:hidden"
          >
            <span className="material-icons-outlined">menu</span>
          </button>
        </div>
      </header>

      <section className="relative pt-20">
        <div className="pointer-events-none absolute right-0 top-0 h-[800px] w-[800px] translate-x-1/3 -translate-y-1/2 rounded-full bg-primary/5 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-[600px] w-[600px] -translate-x-1/4 translate-y-1/3 rounded-full bg-secondary-gold/5 blur-[100px]" />

        <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-12 px-4 py-12 sm:px-6 lg:min-h-[calc(100dvh-5rem)] lg:grid-cols-2 lg:items-stretch lg:px-8 lg:py-0">
          <section className="flex flex-col justify-center space-y-8 lg:h-[calc(100dvh-5rem)] lg:pr-12">
            <div className="inline-flex w-fit self-start items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
              <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-primary" />
              Live Season 4 Now Open
            </div>
            <h1 className="text-5xl font-extrabold leading-[1.1] tracking-tight text-white md:text-6xl">
              Turn Job Hunting into a <span className="gold-gradient-text">Winning Streak</span>.
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-gray-400">
              Stop applying alone. Join a squad, stake your commitment, and race towards your next
              offer. Weekly goals, real financial stakes, real results.
            </p>

            <div className="grid grid-cols-2 gap-4 pt-4">
              <article className="group rounded-xl border border-white/5 bg-surface-dark p-4 transition-all hover:border-primary/30">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    Weekly Streak
                  </span>
                  <span className="material-icons-outlined text-secondary-gold group-hover:animate-bounce">
                    local_fire_department
                  </span>
                </div>
                <div className="text-2xl font-bold text-white">12 Days</div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                  <div className="h-1.5 w-[85%] rounded-full bg-gradient-to-r from-secondary-gold to-orange-500" />
                </div>
              </article>
              <article className="group rounded-xl border border-white/5 bg-surface-dark p-4 transition-all hover:border-primary/30">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    Pot Value
                  </span>
                  <span className="material-icons-outlined text-primary transition-transform group-hover:rotate-12">
                    monetization_on
                  </span>
                </div>
                <div className="text-2xl font-bold text-white">$1,450</div>
                <p className="mt-3 flex items-center text-xs text-primary">
                  <span className="material-icons-outlined mr-1 text-[14px]">trending_up</span>
                  +12% this week
                </p>
              </article>
            </div>

            <div className="flex items-center gap-4 pt-2 text-sm text-gray-500">
              <div className="flex -space-x-3">
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAyqJvLo2MeQCFbMjNlg_jLuzVGqk4UOm3JZDrVfY5Eq8xLbhHyuLwV9ih82rkWOGa5PMQkMf9-1IW1RUQMp_CndKIbpDV8KOdfJAlCH6FUwLVToJ7Iy4wmIm_kv7RpqasMrwKaPSc3UhQ8A40hryidTfL8Op_ochEq2sv_yKuIOLxS2VKz9N3mnfYJEFkip-Q7ldCspvj65_iCbGbnSuyHuImS8AswqJlXH_g6NOadx_VKVoLF52kvUqWsRT8rAStlUZtEoWEzBAk"
                  alt="User portrait"
                  className="h-10 w-10 rounded-full border-2 border-background-dark object-cover"
                />
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuDD0MOdMVWMvqin89txjJgOl0pzlbMFsrIi3RKTlw-drZWs4OKnXY3P5KtIapK1IuMgYMb0arVb3I1qaJuILt0AHzi3MhL4eGGlGAvGtal5HO-5L7W5I8NBEWa1PwUpzPHhdgGIJy8WDQQUdphvs8sLmxpCZ1r1_U7o01AsbC0-aTykK3qotT_9_DKltFPNhLFf7TCtv1I-4JRnqWAHAZlIVZaE8t0le5BTTsodVBGsHQPwC46PgpasCMLGw3igRxEJDezZH6X_khI"
                  alt="User portrait"
                  className="h-10 w-10 rounded-full border-2 border-background-dark object-cover"
                />
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuC8QR0Dx1xJV3hLw8uZX7JkIiNBygIIrv_5Gk__-5e_CLeob71GkcOq4AOZmWPB0Rrd3EePLvwCHRrUkWdpTMMrW3FRkO1nr4zA9jJ4JC7TpQEQaIByLIevN04pZQLNIZ93JgDfBKoOWRjOl0bWhbVZbcCNXQ46p2byGALhwLtggTdFG26pAsHatmJ5L_09E1cWhhzkdKhk1QxJZLqku3kmzjnCk5653j19lg2KmtYyEqVh56Hhduqdk6wPqTr_QjchDYFBbWWIGHM"
                  alt="User portrait"
                  className="h-10 w-10 rounded-full border-2 border-background-dark object-cover"
                />
                <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-background-dark bg-slate-700 text-xs font-bold text-white">
                  +2k
                </div>
              </div>
              <p>Join 2,000+ active challengers today.</p>
            </div>
          </section>

          <section className="flex flex-col justify-center lg:h-[calc(100dvh-5rem)]">
            <div className="relative mx-auto w-full max-w-[620px]">
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-primary to-secondary-gold opacity-20 blur-[32px]" />
              <div className="relative rounded-2xl border border-white/10 bg-surface-dark p-8 shadow-2xl">
                <div className="mb-8 text-center">
                  <h2 className="mb-2 text-2xl font-bold text-white">
                    {isLoginMode ? "Welcome Back" : "Create your Challenger Profile"}
                  </h2>
                  <p className="text-sm text-gray-400">
                    {isLoginMode
                      ? "Sign in to continue your streak."
                      : "Join free for 7 days. No credit card required."}
                  </p>
                </div>

                <div key={authMode} className="auth-panel-enter space-y-4">
                  <button
                    type="button"
                    onClick={() => void continueWithGoogle()}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-semibold text-gray-900 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-secondary-gold focus:ring-offset-2 focus:ring-offset-background-dark disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <img src="/google_logo.png" alt="Google logo" className="h-5 w-5 object-contain" />
                    {isLoginMode ? "Continue with Google" : "Join with Google"}
                  </button>

                  <div className="relative flex items-center py-2">
                    <div className="flex-grow border-t border-gray-700" />
                    <span className="mx-4 flex-shrink-0 text-xs font-bold uppercase tracking-widest text-gray-500">
                      Or with email
                    </span>
                    <div className="flex-grow border-t border-gray-700" />
                  </div>

                  {isLoginMode ? (
                    <form onSubmit={submitLogin} noValidate className="space-y-4">
                      {validationMessage ? (
                        <p
                          key={`${authMode}-alert-${validationBounce}`}
                          className="form-alert-pop text-sm text-red-300"
                        >
                          {validationMessage}
                        </p>
                      ) : null}
                      <div>
                        <label
                          htmlFor="login-email"
                          className="mb-1 ml-1 block text-xs font-medium text-gray-400"
                        >
                          Email
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="material-icons-outlined text-sm text-gray-500">
                              email
                            </span>
                          </span>
                          <input
                            id="login-email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="jane@example.com"
                            aria-required="true"
                            className="block w-full rounded-lg border border-gray-700 bg-background-dark py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="login-password"
                          className="mb-1 ml-1 block text-xs font-medium text-gray-400"
                        >
                          Password
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="material-icons-outlined text-sm text-gray-500">
                              lock
                            </span>
                          </span>
                          <input
                            id="login-password"
                            type={passwordType}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="••••••••"
                            aria-required="true"
                            className="block w-full rounded-lg border border-gray-700 bg-background-dark py-3 pl-10 pr-12 text-white placeholder-gray-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <button
                            type="button"
                            onClick={() => setPasswordVisible((current) => !current)}
                            className="absolute inset-y-0 right-0 px-3 text-gray-500 transition-colors hover:text-gray-300"
                            aria-label={passwordVisible ? "Hide password" : "Show password"}
                          >
                            <span className="material-icons-outlined text-base">
                              {passwordVisible ? "visibility_off" : "visibility"}
                            </span>
                          </button>
                        </div>
                      </div>

                      {error ? <p className="text-sm text-red-300">{error}</p> : null}
                      {notice ? <p className="text-sm text-primary">{notice}</p> : null}

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg bg-primary px-4 py-3 font-bold text-background-dark shadow-lg shadow-primary/20 transition hover:-translate-y-0.5 hover:bg-primary-dark focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background-dark disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {loading ? "Working..." : "Log in"}
                      </button>

                      <div className="space-y-2 text-sm text-gray-400">
                        <p>
                          New here?{" "}
                          <button
                            type="button"
                            onClick={() => toggleMode(signUpView)}
                            className="font-medium text-primary hover:underline"
                          >
                            Create account
                          </button>
                        </p>
                        <p>
                          Forgot Password?{" "}
                          <button
                            type="button"
                            onClick={() => setNotice("Forgot Password is a placeholder for now.")}
                            className="font-medium text-primary hover:underline"
                          >
                            Reset
                          </button>
                        </p>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={submitSignUp} noValidate className="space-y-4">
                      {validationMessage ? (
                        <p
                          key={`${authMode}-alert-${validationBounce}`}
                          className="form-alert-pop text-sm text-red-300"
                        >
                          {validationMessage}
                        </p>
                      ) : null}
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="reg-first-name"
                            className="mb-1 ml-1 block text-xs font-medium text-gray-400"
                          >
                            First Name
                          </label>
                          <input
                            id="reg-first-name"
                            type="text"
                            value={firstName}
                            onChange={(event) => setFirstName(event.target.value)}
                            placeholder="Jane"
                            aria-required="true"
                            className="block w-full rounded-lg border border-gray-700 bg-background-dark px-4 py-3 text-white placeholder-gray-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="reg-last-name"
                            className="mb-1 ml-1 block text-xs font-medium text-gray-400"
                          >
                            Last Name
                          </label>
                          <input
                            id="reg-last-name"
                            type="text"
                            value={lastName}
                            onChange={(event) => setLastName(event.target.value)}
                            placeholder="Doe"
                            aria-required="true"
                            className="block w-full rounded-lg border border-gray-700 bg-background-dark px-4 py-3 text-white placeholder-gray-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="reg-email"
                          className="mb-1 ml-1 block text-xs font-medium text-gray-400"
                        >
                          Work Email
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="material-icons-outlined text-sm text-gray-500">email</span>
                          </span>
                          <input
                            id="reg-email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="jane@example.com"
                            aria-required="true"
                            className="block w-full rounded-lg border border-gray-700 bg-background-dark py-3 pl-10 pr-4 text-white placeholder-gray-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="reg-password"
                          className="mb-1 ml-1 block text-xs font-medium text-gray-400"
                        >
                          Password
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <span className="material-icons-outlined text-sm text-gray-500">
                              lock
                            </span>
                          </span>
                          <input
                            id="reg-password"
                            type={passwordType}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="••••••••"
                            aria-required="true"
                            className="block w-full rounded-lg border border-gray-700 bg-background-dark py-3 pl-10 pr-12 text-white placeholder-gray-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <button
                            type="button"
                            onClick={() => setPasswordVisible((current) => !current)}
                            className="absolute inset-y-0 right-0 px-3 text-gray-500 transition-colors hover:text-gray-300"
                            aria-label={passwordVisible ? "Hide password" : "Show password"}
                          >
                            <span className="material-icons-outlined text-base">
                              {passwordVisible ? "visibility_off" : "visibility"}
                            </span>
                          </button>
                        </div>
                        <div className="ml-1 mt-1 flex items-center gap-2 text-[10px] text-gray-500">
                          <p>Must be at least 8 characters.</p>
                          <div className="group relative inline-flex">
                            <span
                              tabIndex={0}
                              aria-label="Password requirements information"
                              className="inline-flex h-4 w-4 cursor-default items-center justify-center rounded-full border border-gray-600 text-[10px] text-gray-300 transition-colors group-hover:border-primary group-hover:text-primary focus:border-primary focus:text-primary focus:outline-none"
                            >
                              <span className="material-icons-outlined text-[10px] leading-none">info</span>
                            </span>
                            <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-72 translate-y-1 scale-[0.98] rounded-lg border border-primary/30 bg-surface-dark/95 p-3 text-xs text-gray-200 opacity-0 shadow-xl shadow-black/40 backdrop-blur transition-all duration-150 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100">
                              <p className="mb-2 font-semibold text-white">Strong password requirements</p>
                              <ul className="space-y-1 text-gray-300">
                                <li>At least 8 characters</li>
                                <li>At least one uppercase letter (A-Z)</li>
                                <li>At least one lowercase letter (a-z)</li>
                                <li>At least one number (0-9)</li>
                                <li>At least one symbol (e.g. ! @ # $ %)</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex items-start">
                        <div className="flex h-5 items-center">
                          <input
                            id="terms"
                            type="checkbox"
                            checked={termsAccepted}
                            onChange={(event) => setTermsAccepted(event.target.checked)}
                            className="welcome-checkbox h-4 w-4 rounded border-gray-700 bg-background-dark text-primary focus:ring-primary focus:ring-offset-background-dark"
                          />
                        </div>
                        <div className="ml-2 text-xs text-gray-400">
                          <span className="font-medium">
                            <label htmlFor="terms">I agree to the </label>
                            <a
                              href={termsOfUseHref}
                              target="_blank"
                              rel="noreferrer noopener"
                              onClick={(event) => event.stopPropagation()}
                              className="text-primary hover:underline"
                            >
                              Terms
                            </a>{" "}
                            and{" "}
                            <a
                              href={privacyPolicyHref}
                              target="_blank"
                              rel="noreferrer noopener"
                              onClick={(event) => event.stopPropagation()}
                              className="text-primary hover:underline"
                            >
                              Privacy Policy
                            </a>
                            .
                          </span>
                        </div>
                      </div>

                      {error ? <p className="text-sm text-red-300">{error}</p> : null}
                      {notice ? <p className="text-sm text-primary">{notice}</p> : null}

                      <button
                        type="submit"
                        disabled={loading}
                        className="mt-6 w-full rounded-lg bg-primary px-4 py-3 font-bold text-background-dark shadow-lg shadow-primary/20 transition hover:-translate-y-0.5 hover:bg-primary-dark focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background-dark disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {loading ? "Working..." : "Sing up"}
                      </button>

                      <p className="text-sm text-gray-400">
                        Already have an account?{" "}
                        <button
                          type="button"
                          onClick={() => toggleMode(loginView)}
                          className="font-medium text-primary hover:underline"
                        >
                          Log in
                        </button>
                      </p>
                    </form>
                  )}
                </div>
              </div>
              <div className="mt-4 text-center">
                <p className="flex items-center justify-center gap-1 text-[10px] text-gray-500">
                  <span className="material-icons-outlined text-[12px]">verified_user</span>
                  Secure payments &amp; data encryption
                </p>
              </div>
            </div>
          </section>
        </div>
      </section>

      <section className="border-t border-white/5 bg-surface-dark/50">
        <div className="mx-auto flex w-full max-w-7xl min-h-[calc(100dvh-5rem)] flex-col px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="flex-1">
            <div className="mb-12 text-center">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">
                The Gameplay Loop
              </h3>
              <h2 className="text-3xl font-bold text-white">How to Play to Win</h2>
            </div>
            <div className="grid gap-8 md:grid-cols-3">
              <article className="group relative overflow-hidden rounded-xl border border-white/5 bg-background-dark p-6 transition-all hover:border-primary/20">
                <span className="absolute right-0 top-0 p-4 text-6xl font-black text-gray-500/10 transition-colors group-hover:text-primary/20">
                  01
                </span>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <span className="material-icons-outlined">groups</span>
                </div>
                <h3 className="mb-2 text-xl font-bold text-white">Join a Squad</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  Get matched with 4 other job seekers in your field. This is your accountability
                  team.
                </p>
              </article>

              <article className="group relative overflow-hidden rounded-xl border border-white/5 bg-background-dark p-6 transition-all hover:border-secondary-gold/20">
                <span className="absolute right-0 top-0 p-4 text-6xl font-black text-gray-500/10 transition-colors group-hover:text-secondary-gold/20">
                  02
                </span>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary-gold/10 text-secondary-gold transition-transform group-hover:scale-110">
                  <span className="material-icons-outlined">attach_money</span>
                </div>
                <h3 className="mb-2 text-xl font-bold text-white">Set Your Stakes</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  Commit a small amount to the pot. Hit your application goals to keep your stake.
                  Miss them, and you pay out.
                </p>
              </article>

              <article className="group relative overflow-hidden rounded-xl border border-white/5 bg-background-dark p-6 transition-all hover:border-primary/20">
                <span className="absolute right-0 top-0 p-4 text-6xl font-black text-gray-500/10 transition-colors group-hover:text-primary/20">
                  03
                </span>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <span className="material-icons-outlined">emoji_events</span>
                </div>
                <h3 className="mb-2 text-xl font-bold text-white">Win the Pot</h3>
                <p className="text-sm leading-relaxed text-gray-400">
                  Those who hit 100% of their goals split the pot from those who did not. Get
                  hired faster and get paid.
                </p>
              </article>
            </div>
          </div>

          <footer className="mt-12 border-t border-white/5 pt-8">
            <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/20 text-xs font-bold text-primary">
                  <span className="material-icons text-sm">offline_bolt</span>
                </div>
                <span className="text-sm text-gray-400">© 2026 IncentApply</span>
              </div>
              <div className="flex space-x-6 text-sm text-gray-500">
                <a
                  href={privacyPolicyHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="transition-colors hover:text-white"
                >
                  Privacy
                </a>
                <a
                  href={termsOfUseHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="transition-colors hover:text-white"
                >
                  Terms
                </a>
                <button
                  type="button"
                  className="transition-colors hover:text-white"
                >
                  Support
                </button>
              </div>
            </div>
          </footer>
        </div>
      </section>
    </main>
  );
}
