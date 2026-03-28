import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import AuthShell from "../components/layout/AuthShell";

const VEHICLE_COLORS = [
  "gray", "red", "blue", "green", "black", "white", "silver", "yellow", "orange"
];
const VEHICLE_TYPES = [
  { value: "car", label: "Car" },
  { value: "bicycle", label: "Bicycle" },
  { value: "on_foot", label: "On Foot" }
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
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (form.password.length < 6) {
      setError("Password should be at least 6 characters");
      return;
    }

    try {
      setLoading(true);
      const { error, data } = await signUp(form.email, form.password, {
        data: {
          full_name: form.name,
          address: form.address,
          vehicle_type: form.vehicleType,           // new
          car_type: form.carType,
          registration_number: form.regNumber,
          vehicle_color: form.vehicleColor,
        }
      });
      if (error) throw error;

      if (data?.user && !data.user.email_confirmed_at) {
        navigate("/confirm-email", { state: { email: form.email } });
      } else {
        navigate("/sop");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Create account">
      <form
        onSubmit={handleSubmit}
        className="card w-full max-w-md p-6 sm:p-8 space-y-4"
      >
        <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white">
          Register
        </h2>

        <input
          name="name"
          placeholder="Full Name"
          value={form.name}
          onChange={handleChange}
          className="input border"
          required
        />

        <input
          name="address"
          placeholder="Address"
          value={form.address}
          onChange={handleChange}
          className="input border"
          required
        />

        {/* Vehicle Type Selector */}
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">Vehicle Type</label>
          <select
            name="vehicleType"
            value={form.vehicleType}
            onChange={handleChange}
            className="input border"
          >
            {VEHICLE_TYPES.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>

        {/* Car Make & Model (only for cars) */}
        {form.vehicleType === 'car' && (
          <input
            name="carType"
            placeholder="Car Type (e.g. Toyota Corolla)"
            value={form.carType}
            onChange={handleChange}
            className="input border"
          />
        )}

        {/* Registration Number (for car or bicycle) */}
        {(form.vehicleType === 'car' || form.vehicleType === 'bicycle') && (
          <input
            name="regNumber"
            placeholder={form.vehicleType === 'car' ? "Registration Number" : "Bicycle Identifier (optional)"}
            value={form.regNumber}
            onChange={handleChange}
            className="input border"
          />
        )}

        {/* Vehicle Color (for car or bicycle) */}
        {(form.vehicleType === 'car' || form.vehicleType === 'bicycle') && (
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Vehicle Color</label>
            <select
              name="vehicleColor"
              value={form.vehicleColor}
              onChange={handleChange}
              className="input border"
            >
              {VEHICLE_COLORS.map(color => (
                <option key={color} value={color}>
                  {color.charAt(0).toUpperCase() + color.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}

        <input
          name="email"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          className="input border"
          required
        />

        <input
          name="password"
          type="password"
          placeholder="Password (min 6 characters)"
          value={form.password}
          onChange={handleChange}
          className="input border"
          required
        />

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