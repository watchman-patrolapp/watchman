import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import AuthShell from "../components/layout/AuthShell";
import { setPreferSessionAuth } from "../supabase/authStorage";

export default function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      setPreferSessionAuth(!staySignedIn);
      const { error } = await signIn(email, password);
      if (error) throw error;
      navigate("/dashboard");
    } catch (err) {
      console.error("Login error:", err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <form
        onSubmit={handleLogin}
        className="card w-full max-w-md p-6 sm:p-8 space-y-4"
      >
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white">
          Sign in
        </h2>

        <div>
          <label htmlFor="login-email" className="sr-only">Email</label>
          <input
            id="login-email"
            type="email"
            name="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input border"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <label htmlFor="login-password" className="sr-only">Password</label>
          <input
            id="login-password"
            type="password"
            name="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input border"
            autoComplete="current-password"
            required
          />
        </div>

        <label className="flex items-start gap-3 cursor-pointer text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={staySignedIn}
            onChange={(e) => setStaySignedIn(e.target.checked)}
            className="mt-1 rounded border-gray-300 dark:border-gray-600 text-teal-600 focus:ring-teal-500"
          />
          <span>
            <span className="font-medium text-gray-800 dark:text-gray-200">Stay signed in on this device</span>
            <span className="block text-xs text-gray-500 dark:text-gray-500 mt-0.5">
              Turn off on a shared computer — you’ll be signed out when you close the browser.
            </span>
          </span>
        </label>

        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm text-center" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-sm text-gray-600 dark:text-gray-400">
          Don’t have an account?{" "}
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="text-teal-600 dark:text-teal-400 font-semibold hover:underline"
          >
            Register
          </button>
        </p>
      </form>
    </AuthShell>
  );
}
