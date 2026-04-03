import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import AuthShell from "../components/layout/AuthShell";
import { setPreferSessionAuth } from "../supabase/authStorage";
import { formatAuthErrorMessage } from "../utils/authErrorMessage";
import {
  REGISTER_VEHICLE_TYPE_OPTIONS,
  isLightMobilityVehicleType,
  getLightMobilityDefaultModel,
} from "../utils/vehicleTypeConstants";

const VEHICLE_COLORS = [
  "gray", "red", "blue", "green", "black", "white", "silver", "yellow", "orange"
];

function Register() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [form, setForm] = useState({
    name: "",
    address: "",
    vehicleType: "car",
    carType: "",
    regNumber: "",
    vehicleColor: "gray",
    phone: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedAge18, setAcceptedAge18] = useState(false);
  const [acceptedSop, setAcceptedSop] = useState(false);
  const [acceptedPopia, setAcceptedPopia] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    if (name === "vehicleType") {
      setForm((prev) => {
        const next = { ...prev, vehicleType: value };
        if (isLightMobilityVehicleType(value)) {
          next.carType = getLightMobilityDefaultModel(value);
          next.regNumber = "N/A";
        } else if (isLightMobilityVehicleType(prev.vehicleType)) {
          next.carType = "";
          next.regNumber = "";
        }
        if (value === "boat" || isLightMobilityVehicleType(value)) {
          next.vehicleColor = "gray";
        }
        return next;
      });
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const name = form.name.trim();
    const address = form.address.trim();
    if (!name) {
      setError("Full Name is required.");
      return;
    }
    if (!address) {
      setError("Address is required.");
      return;
    }
    if (form.vehicleType === "car" || form.vehicleType === "motorcycle") {
      if (!form.carType.trim()) {
        setError(form.vehicleType === "motorcycle" ? "Make & model is required." : "Car type is required.");
        return;
      }
      if (!form.regNumber.trim()) {
        setError(
          form.vehicleType === "motorcycle"
            ? "Number plate is required."
            : "Registration number is required."
        );
        return;
      }
    }
    if (form.vehicleType === "boat") {
      if (!form.carType.trim()) {
        setError("Boat name is required.");
        return;
      }
      if (!form.regNumber.trim()) {
        setError("Boat registration number is required.");
        return;
      }
    }
    if (form.vehicleType === "bicycle") {
      if (!form.carType.trim()) {
        setError("Bicycle description is required.");
        return;
      }
      if (!form.regNumber.trim()) {
        setError("Registration number (or bicycle ID) is required.");
        return;
      }
    }

    const email = form.email.trim();
    const phone = form.phone.trim();
    if (!phone) {
      setError("Phone number is required.");
      return;
    }
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      setError("Enter a valid phone number (at least 10 digits).");
      return;
    }
    if (!email) {
      setError("Email address is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password should be at least 6 characters");
      return;
    }
    if (!acceptedAge18 || !acceptedSop || !acceptedPopia || !acceptedTerms) {
      setError(
        "You must confirm you are 18 or older and accept SOP, POPIA, and terms to register."
      );
      return;
    }

    try {
      setLoading(true);
      setPreferSessionAuth(false);
      const acceptedAt = new Date().toISOString();
      const { error, data } = await signUp(email, form.password, {
        data: {
          full_name: name,
          address,
          phone,
          vehicle_type: form.vehicleType,
          car_type: form.carType.trim(),
          registration_number: form.regNumber.trim(),
          vehicle_color:
            isLightMobilityVehicleType(form.vehicleType) || form.vehicleType === "boat"
              ? "gray"
              : form.vehicleColor,
          age_18_confirmed_at: acceptedAt,
          sop_accepted_at: acceptedAt,
          popia_accepted_at: acceptedAt,
          terms_accepted_at: acceptedAt,
          consent_version: "2026-03-30",
        }
      });
      if (error) throw error;

      if (data?.user && !data.user.email_confirmed_at) {
        navigate("/confirm-email", { state: { email } });
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(formatAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const lightMobility = isLightMobilityVehicleType(form.vehicleType);
  const showVehicleColor =
    !lightMobility && form.vehicleType !== "boat";

  return (
    <AuthShell title="Create account">
      <form
        onSubmit={handleSubmit}
        className="card w-full max-w-md p-6 sm:p-8 space-y-4"
      >
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white">
          Register
        </h2>

        <div>
          <label htmlFor="reg-name" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Full Name <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input
            id="reg-name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Full name"
            value={form.name}
            onChange={handleChange}
            className="input border w-full"
            required
          />
        </div>

        <div>
          <label htmlFor="reg-address" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Address <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input
            id="reg-address"
            name="address"
            type="text"
            autoComplete="street-address"
            placeholder="Address"
            value={form.address}
            onChange={handleChange}
            className="input border w-full"
            required
          />
        </div>

        <div>
          <label htmlFor="reg-vehicle-type" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Vehicle Type <span className="text-red-500" aria-hidden>*</span>
          </label>
          <select
            id="reg-vehicle-type"
            name="vehicleType"
            value={form.vehicleType}
            onChange={handleChange}
            className="input border w-full"
            required
          >
            {REGISTER_VEHICLE_TYPE_OPTIONS.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="reg-car-type" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            {form.vehicleType === "boat"
              ? "Boat name"
              : form.vehicleType === "motorcycle"
                ? "Make & model"
                : form.vehicleType === "bicycle"
                  ? "Bicycle description"
                  : "Car type"}{" "}
            <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input
            id="reg-car-type"
            name="carType"
            type="text"
            placeholder={
              lightMobility
                ? getLightMobilityDefaultModel(form.vehicleType)
                : form.vehicleType === "bicycle"
                  ? "e.g. Mountain bike"
                  : form.vehicleType === "boat"
                    ? "e.g. Sea Ray"
                    : form.vehicleType === "motorcycle"
                      ? "e.g. Honda CB500"
                      : "e.g. Toyota Corolla"
            }
            value={form.carType}
            onChange={handleChange}
            className="input border w-full disabled:opacity-70"
            disabled={lightMobility}
            required={!lightMobility}
          />
          {lightMobility && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Set automatically for this patrol mode (no extra details).
            </p>
          )}
        </div>

        <div>
          <label htmlFor="reg-reg" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            {form.vehicleType === "motorcycle" ? "Number plate" : "Registration number"}{" "}
            <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input
            id="reg-reg"
            name="regNumber"
            type="text"
            placeholder={
              lightMobility
                ? "N/A"
                : form.vehicleType === "bicycle"
                  ? "Bicycle ID or frame number"
                  : form.vehicleType === "motorcycle"
                    ? "e.g. GP 123-456"
                    : form.vehicleType === "boat"
                      ? "Hull or registration ID"
                      : "Registration number"
            }
            value={form.regNumber}
            onChange={handleChange}
            className="input border w-full disabled:opacity-70"
            disabled={lightMobility}
            required={!lightMobility}
          />
        </div>

        {showVehicleColor ? (
        <div>
          <label htmlFor="reg-color" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Vehicle Color <span className="text-red-500" aria-hidden>*</span>
          </label>
          <select
            id="reg-color"
            name="vehicleColor"
            value={form.vehicleColor}
            onChange={handleChange}
            className="input border w-full"
            required
          >
            {VEHICLE_COLORS.map((color) => (
              <option key={color} value={color}>
                {color.charAt(0).toUpperCase() + color.slice(1)}
              </option>
            ))}
          </select>
        </div>
        ) : null}

        <div>
          <label htmlFor="reg-phone" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Phone number <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input
            id="reg-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="e.g. 082 123 4567"
            value={form.phone}
            onChange={handleChange}
            className="input border w-full"
            required
          />
        </div>

        <div>
          <label htmlFor="reg-email" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Email address <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input
            id="reg-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={handleChange}
            className="input border w-full"
            required
          />
        </div>

        <div>
          <label htmlFor="reg-password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Password <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input
            id="reg-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 6 characters"
            value={form.password}
            onChange={handleChange}
            className="input border w-full"
            required
            minLength={6}
          />
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Required agreements
          </p>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedAge18}
              onChange={(e) => setAcceptedAge18(e.target.checked)}
              className="mt-0.5 w-4 h-4"
              required
            />
            <span>I confirm I am 18 years of age or older.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedSop}
              onChange={(e) => setAcceptedSop(e.target.checked)}
              className="mt-0.5 w-4 h-4"
              required
            />
            <span>I have read and accept the Standard Operating Procedures (SOP).</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedPopia}
              onChange={(e) => setAcceptedPopia(e.target.checked)}
              className="mt-0.5 w-4 h-4"
              required
            />
            <span>I consent to POPIA-compliant processing of my personal information for neighborhood watch operations.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4"
              required
            />
            <span>I accept the platform terms and community conduct rules.</span>
          </label>
        </div>

        {error && (
          <p className="text-red-600 text-sm text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? "Registering…" : "Register"}
        </button>

        <p className="text-center text-sm text-gray-600 dark:text-gray-400">
          Already registered?{" "}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="text-teal-600 dark:text-teal-400 font-semibold hover:underline focus:outline-none"
          >
            Sign in
          </button>
        </p>
      </form>
    </AuthShell>
  );
}

export default Register;
