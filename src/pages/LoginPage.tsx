import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import { AuthButtons } from "../components/ui/AuthButtons";
import { FormField } from "../components/ui/FormField";

export function LoginPage() {
  const { signInWithGoogle, signInWithPassword, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("alex@incentapply.dev");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";

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
    <main className="flex min-h-screen items-center justify-center bg-background-dark px-4 text-white">
      <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-2xl border border-primary/15 bg-surface-dark p-7">
        <h1 className="text-2xl font-bold">Log In</h1>
        <FormField id="login-email" label="Email" value={email} onChange={setEmail} type="email" required />
        <FormField
          id="login-password"
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
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
    </main>
  );
}
