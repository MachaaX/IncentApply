import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthContext";
import { AuthButtons } from "../components/ui/AuthButtons";
import { FormField } from "../components/ui/FormField";

export function RegisterPage() {
  const { registerWithEmail, signUpWithGoogle, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("oauthError") !== "1") {
      return;
    }
    const message = params.get("message");
    setError(message ?? "Unable to continue with Google.");
  }, [location.search]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      await registerWithEmail({ firstName, lastName, email, password });
      navigate("/dashboard", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to register.");
    }
  };

  const google = async () => {
    setError(null);
    try {
      await signUpWithGoogle(email);
      navigate("/dashboard", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to continue with Google.");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background-dark px-4 text-white">
      <form onSubmit={submit} className="w-full max-w-lg space-y-5 rounded-2xl border border-primary/15 bg-surface-dark p-7">
        <h1 className="text-2xl font-bold">Create Account</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="reg-first-name"
            label="First Name"
            value={firstName}
            onChange={setFirstName}
            placeholder="Jane"
            required
          />
          <FormField
            id="reg-last-name"
            label="Last Name"
            value={lastName}
            onChange={setLastName}
            placeholder="Doe"
            required
          />
        </div>
        <FormField
          id="reg-email"
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          placeholder="you@example.com"
          required
        />
        <FormField
          id="reg-password"
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          placeholder="Create a password"
          helperText="At least 8 characters"
          required
        />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <AuthButtons onGoogle={google} submitting={loading} submitLabel="Create Account" />
        <p className="text-sm text-slate-400">
          Already have an account?{" "}
          <Link to="/auth/login" className="text-primary hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
