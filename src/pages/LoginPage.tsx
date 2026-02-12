import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import { AuthButtons } from "../components/ui/AuthButtons";
import { FormField } from "../components/ui/FormField";

export function LoginPage() {
  const { signInWithGoogle, signInWithPassword, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? "/my-groups";

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("oauthError") !== "1") {
      return;
    }
    const message = params.get("message");
    setError(message ?? "Unable to sign in with Google.");
  }, [location.search]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      await signInWithPassword(email, password);
      navigate(from, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
    }
  };

  const google = async () => {
    setError(null);
    try {
      await signInWithGoogle(email);
      navigate(from, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in with Google.");
    }
  };

  return (
    <main className="min-h-screen bg-background-dark px-4 text-white">
      <div className="mx-auto grid min-h-screen w-full max-w-md grid-rows-[1fr_auto_1fr]">
        <div className="flex items-center justify-center py-6">
          <Link
            to="/welcome"
            className="inline-flex items-center justify-center gap-3 rounded-lg transition-opacity hover:opacity-90"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-background-dark">
              <span className="material-icons text-lg">offline_bolt</span>
            </div>
            <span className="text-lg font-bold tracking-tight text-white">IncentApply</span>
          </Link>
        </div>
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-primary/15 bg-surface-dark p-7">
          <h1 className="text-2xl font-bold">Log In</h1>
          <FormField
            id="login-email"
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="you@example.com"
            required
          />
          <FormField
            id="login-password"
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="Enter your password"
            showPasswordToggle
            required
          />
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <AuthButtons onGoogle={google} submitting={loading} submitLabel="Log In" />
          <p className="text-sm text-slate-400">
            New here?{" "}
            <Link to="/auth/register" className="text-primary hover:underline">
              Create account
            </Link>
          </p>
        </form>
        <div aria-hidden="true" />
      </div>
    </main>
  );
}
