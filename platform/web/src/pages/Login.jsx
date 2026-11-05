import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import AuthShell from "../components/layout/AuthShell";
import Button from "../components/ui/Button";
import FormField from "../components/ui/FormField";
import IconButton from "../components/ui/IconButton";
import { setPreferSessionAuth } from "../supabase/authStorage";
import { formatAuthErrorMessage } from "../utils/authErrorMessage";

function emailErrorFor(value) {
  const email = value.trim();
  if (!email) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return "";
}

function passwordErrorFor(value) {
  if (!value) return "Password is required.";
  return "";
}

export default function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    const nextEmailError = emailErrorFor(email);
    const nextPasswordError = passwordErrorFor(password);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setError("");
    if (nextEmailError || nextPasswordError) return;

    setLoading(true);
    try {
      setPreferSessionAuth(!staySignedIn);
      const { error: signInError } = await signIn(email, password);
      if (signInError) throw signInError;
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
      <form
        onSubmit={handleLogin}
        className="card w-full max-w-md space-y-4 p-6 sm:p-8"
        noValidate
      >
        <div>
          <h2 className="text-center text-2xl font-bold text-text-primary">Sign in</h2>
          <p className="mt-1 text-center text-sm text-text-secondary">
            Use the email and password for your watch account.
          </p>
        </div>

        <FormField id="login-email" label="Email" required error={emailError}>
          <input
            id="login-email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(emailErrorFor(e.target.value));
            }}
            onBlur={() => setEmailError(emailErrorFor(email))}
            className="input border w-full"
          />
        </FormField>

        <FormField id="login-password" label="Password" required error={passwordError}>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError(passwordErrorFor(e.target.value));
              }}
              onBlur={() => setPasswordError(passwordErrorFor(password))}
              className="input border w-full pr-12"
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "login-password-error" : undefined}
            />
            <IconButton
              label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 right-0 text-text-secondary hover:text-text-primary"
            >
              {showPassword ? (
                <FaEyeSlash className="h-4 w-4" aria-hidden />
              ) : (
                <FaEye className="h-4 w-4" aria-hidden />
              )}
            </IconButton>
          </div>
        </FormField>

        <div className="text-right">
          <Link to="/forgot-password" className="text-sm font-medium text-text-link underline">
            Forgot password?
          </Link>
        </div>

        <label className="flex cursor-pointer items-start gap-3 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={staySignedIn}
            onChange={(e) => setStaySignedIn(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-strong"
          />
          <span>
            <span className="font-medium text-text-primary">Stay signed in on this device</span>
            <span className="mt-0.5 block text-sm text-text-tertiary">
              Turn off on a shared computer — you’ll be signed out when you close the browser.
            </span>
          </span>
        </label>

        {error ? (
          <p className="text-center text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {loading ? "Signing in" : ""}
        </p>

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Signing in…" : "Sign in"}
        </Button>

        <p className="text-center text-sm text-text-secondary">
          Don’t have an account?{" "}
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="font-semibold text-text-link underline"
          >
            Register
          </button>
        </p>
      </form>
    </AuthShell>
  );
}
