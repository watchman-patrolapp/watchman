import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import AuthShell from "../components/layout/AuthShell";
import BrandedLoader from "../components/layout/BrandedLoader";
import { setPreferSessionAuth } from "../supabase/authStorage";
import { formatAuthErrorMessage } from "../utils/authErrorMessage";

export default function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      setError(formatAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      {loading ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/35 backdrop-blur-[2px] dark:bg-black/45"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Signing in</span>
          <div className="rounded-2xl bg-white/95 p-8 shadow-xl dark:bg-gray-800/95">
            <BrandedLoader message="Signing in…" size="md" />
          </div>
        </div>
      ) : null}
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
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              name="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input border w-full pr-10"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 rounded-r"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <FaEyeSlash className="w-4 h-4" aria-hidden />
              ) : (
                <FaEye className="w-4 h-4" aria-hidden />
              )}
            </button>
          </div>
          <div className="mt-1.5 text-right">
            <Link
              to="/forgot-password"
              className="text-sm text-teal-600 dark:text-teal-400 font-medium hover:underline"
            >
              Forgot password?
            </Link>
          </div>
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
