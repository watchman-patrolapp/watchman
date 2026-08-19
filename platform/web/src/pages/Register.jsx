import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaArrowLeft, FaEye, FaEyeSlash } from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import {
  emptyRegisterForm,
  formatPersonName,
  getRegisterTrack,
  validateRegisterForm,
} from "../auth/registerTracks";
import { EMERGENCY_CONTACT_RELATIONSHIPS } from "../utils/emergencyContact";
import AuthShell from "../components/layout/AuthShell";
import RegisterRolePicker from "../components/register/RegisterRolePicker";
import RegisterVehicleFields from "../components/register/RegisterVehicleFields";
import { setPreferSessionAuth } from "../supabase/authStorage";
import { formatAuthErrorMessage } from "../utils/authErrorMessage";
import { loadPublicSignupOptions, securityCompanyOptionLabel } from "../utils/signupOptions";
import { DEFAULT_CITY_FULL_NAME } from "../config/neighborhoodRegions";
import {
  isLightMobilityVehicleType,
  getLightMobilityDefaultModel,
} from "../utils/vehicleTypeConstants";

function Field({ id, label, required, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
        {label}
        {required ? <span className="text-red-500" aria-hidden> *</span> : (
          <span className="text-gray-400 font-normal"> (optional)</span>
        )}
      </label>
      {children}
      {hint ? <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{hint}</p> : null}
    </div>
  );
}

function validateVehicleDetails(form) {
  if (form.vehicleType === "car" || form.vehicleType === "motorcycle") {
    if (!form.carType.trim()) {
      return form.vehicleType === "motorcycle" ? "Make & model is required." : "Car type is required.";
    }
    if (!form.regNumber.trim()) {
      return form.vehicleType === "motorcycle"
        ? "Number plate is required."
        : "Registration number is required.";
    }
  }
  if (form.vehicleType === "boat") {
    if (!form.carType.trim()) return "Boat name is required.";
    if (!form.regNumber.trim()) return "Boat registration number is required.";
  }
  if (form.vehicleType === "bicycle") {
    if (!form.carType.trim()) return "Bicycle description is required.";
    if (!form.regNumber.trim()) return "Registration number (or bicycle ID) is required.";
  }
  return "";
}

function compactSignupMetadata(metadata) {
  const blockedAuthColumns = new Set(["role", "phone", "email", "password"]);
  const compact = {};
  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (blockedAuthColumns.has(key)) return;
    if (value == null) return;
    if (typeof value === "string" && value.trim() === "") return;
    compact[key] = value;
  });
  return compact;
}

function buildSignupMetadata(track, form, acceptedAt) {
  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  const name = formatPersonName(firstName, lastName);
  const phone = form.phone.trim();
  const address = form.address.trim();
  const metadata = {
    first_name: firstName,
    last_name: lastName,
    full_name: name,
    contact_phone: phone,
    signup_track: track.id,
    app_role: track.appRole,
    age_18_confirmed_at: acceptedAt,
    popia_accepted_at: acceptedAt,
    terms_accepted_at: acceptedAt,
    consent_version: "2026-08-15",
  };

  if (track.requiresSop || track.requiresPartnerAgreement) {
    metadata.sop_accepted_at = acceptedAt;
  }

  if (track.requiresAddress) {
    metadata.address = address;
  }

  if (track.requiresNeighborhood) {
    metadata.neighborhood_organization_id = form.neighborhoodOrganizationId || null;
    metadata.neighborhood_name = form.neighborhoodName.trim() || null;
  }

  if (track.showEmergencyContact) {
    const emergencyName = formatPersonName(
      form.emergencyContactFirstName,
      form.emergencyContactLastName
    );
    metadata.emergency_contact_first_name = form.emergencyContactFirstName.trim() || null;
    metadata.emergency_contact_last_name = form.emergencyContactLastName.trim() || null;
    metadata.emergency_contact_name = emergencyName || null;
    metadata.emergency_contact_phone = form.emergencyContactPhone.trim() || null;
    metadata.emergency_contact_relationship = form.emergencyContactRelationship.trim() || null;
  }

  if (track.requiresVehicle) {
    metadata.vehicle_type = form.vehicleType;
    metadata.car_type = form.carType.trim();
    metadata.registration_number = form.regNumber.trim();
    metadata.vehicle_color =
      isLightMobilityVehicleType(form.vehicleType) || form.vehicleType === "boat"
        ? "gray"
        : form.vehicleColor;
  }

  if (track.showSecurityMembership) {
    const hasCompany = Boolean(form.securityCompanyId);
    metadata.security_membership = hasCompany ? "yes" : "prefer_not_to_say";
    metadata.security_company_id = form.securityCompanyId || null;
    metadata.security_company_name = form.securityCompanyName.trim() || null;
    metadata.security_membership_reference = form.securityMembershipReference.trim() || null;
  }

  if (track.requiresCompanyProfile) {
    metadata.company_organization_id = form.companyOrganizationId || null;
    metadata.company_name = form.companyName.trim();
    metadata.company_registration = form.companyRegistration.trim();
    metadata.company_address = form.companyAddress.trim();
    metadata.coverage_scope = form.coverageScope || null;
    metadata.coverage_organization_ids =
      form.coverageScope === "areas" ? form.coverageOrganizationIds || [] : [];
    metadata.coverage_organization_id =
      form.coverageScope === "areas" ? (form.coverageOrganizationIds || [])[0] || null : null;
    metadata.coverage_area = form.coverageArea.trim();
    metadata.job_title = form.jobTitle.trim() || null;
    metadata.address = form.companyAddress.trim();
  }

  if (track.requiresWatchProfile) {
    metadata.watch_name = form.watchName.trim();
    metadata.watch_area = form.watchArea.trim();
    metadata.neighborhood_name = form.watchArea.trim();
  }

  return metadata;
}

function Register() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { signUp } = useAuth();
  const track = useMemo(() => getRegisterTrack(searchParams.get("as")), [searchParams]);

  const [form, setForm] = useState(emptyRegisterForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedAge18, setAcceptedAge18] = useState(false);
  const [acceptedSop, setAcceptedSop] = useState(false);
  const [acceptedPartner, setAcceptedPartner] = useState(false);
  const [acceptedPopia, setAcceptedPopia] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [areas, setAreas] = useState([]);
  const [securityCompanies, setSecurityCompanies] = useState([]);
  const [signupCityName, setSignupCityName] = useState(DEFAULT_CITY_FULL_NAME);
  const [signupOptionsLoading, setSignupOptionsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setSignupOptionsLoading(true);
      try {
        const options = await loadPublicSignupOptions();
        if (cancelled) return;
        setAreas(options.areas);
        setSecurityCompanies(options.securityCompanies);
        if (options.city?.name) setSignupCityName(options.city.name);
      } catch (err) {
        console.warn("Register: could not load signup options", err);
        if (!cancelled) {
          setAreas([]);
          setSecurityCompanies([]);
        }
      } finally {
        if (!cancelled) setSignupOptionsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (name === "neighborhoodOrganizationId") {
      const area = areas.find((row) => row.id === value);
      setForm((prev) => ({
        ...prev,
        neighborhoodOrganizationId: value,
        neighborhoodName: area?.name || "",
      }));
      return;
    }
    if (name === "securityCompanyId") {
      const company = securityCompanies.find((row) => row.id === value);
      setForm((prev) => ({
        ...prev,
        securityCompanyId: value,
        securityCompanyName: company?.name || "",
        securityMembership: value ? "yes" : "prefer_not_to_say",
      }));
      return;
    }
    if (name === "companyOrganizationId") {
      const company = securityCompanies.find((row) => row.id === value);
      setForm((prev) => ({
        ...prev,
        companyOrganizationId: value,
        companyName: company?.name || "",
        companyRegistration: company?.psiraReg || prev.companyRegistration,
      }));
      return;
    }
    if (name === "coverageScope") {
      setForm((prev) => ({
        ...prev,
        coverageScope: value,
        coverageOrganizationIds: value === "city" ? [] : prev.coverageOrganizationIds,
        coverageOrganizationId: value === "city" ? "" : prev.coverageOrganizationId,
        coverageArea: value === "city" ? DEFAULT_CITY_FULL_NAME : prev.coverageArea,
      }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function selectTrack(id) {
    setError("");
    setSearchParams({ as: id });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!track) return;

    const baseError = validateRegisterForm(track, form);
    if (baseError) {
      setError(baseError);
      return;
    }
    if (track.requiresVehicle) {
      const vehicleError = validateVehicleDetails(form);
      if (vehicleError) {
        setError(vehicleError);
        return;
      }
    }
    if (track.requiresNeighborhood && !form.neighborhoodOrganizationId) {
      setError("Please choose a suburb / neighborhood from the list.");
      return;
    }
    if (!acceptedAge18 || !acceptedPopia || !acceptedTerms) {
      setError("You must confirm you are 18 or older and accept POPIA and terms to register.");
      return;
    }
    if (track.requiresSop && !acceptedSop) {
      setError("You must accept the Standard Operating Procedures (SOP) to register as a patroller or watch admin.");
      return;
    }
    if (track.requiresPartnerAgreement && !acceptedPartner) {
      setError("You must accept the security partner operating agreement to register.");
      return;
    }

    try {
      setLoading(true);
      setPreferSessionAuth(false);
      const acceptedAt = new Date().toISOString();
      const email = form.email.trim();
      const { error: signUpError, data } = await signUp(email, form.password, {
        data: compactSignupMetadata(buildSignupMetadata(track, form, acceptedAt)),
      });
      if (signUpError) throw signUpError;

      if (data?.user && !data.user.email_confirmed_at) {
        navigate("/confirm-email", { state: { email, signupTrack: track.id } });
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(formatAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!track) {
    return (
      <AuthShell title="Create account" wide>
        <RegisterRolePicker
          onSelect={selectTrack}
          onSignIn={() => navigate("/login")}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Register · ${track.label}`} wide>
      <form
        onSubmit={handleSubmit}
        className="card w-full max-w-xl p-6 sm:p-8 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-teal-700 dark:text-teal-400 font-semibold">
              Step 2 of 2
            </p>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {track.label} details
            </h2>
            {track.id === "resident" ? (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">(All compulsory entries)</p>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{track.tagline}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setError("");
              setSearchParams({});
            }}
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-teal-700 dark:hover:text-teal-400"
          >
            <FaArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Change role
          </button>
        </div>

        <section className="space-y-4">
          {track.id === "resident" ? null : (
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Account</h3>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="reg-first-name" label="Name" required>
              <input
                id="reg-first-name"
                name="firstName"
                type="text"
                autoComplete="given-name"
                placeholder="Name"
                value={form.firstName}
                onChange={handleChange}
                className="input border w-full"
                required
              />
            </Field>
            <Field id="reg-last-name" label="Surname" required>
              <input
                id="reg-last-name"
                name="lastName"
                type="text"
                autoComplete="family-name"
                placeholder="Surname"
                value={form.lastName}
                onChange={handleChange}
                className="input border w-full"
                required
              />
            </Field>
          </div>
          <Field id="reg-phone" label="Phone number" required hint="Used for emergency coordination.">
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
          </Field>
          <Field id="reg-email" label="Email address" required>
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
          </Field>
          <Field id="reg-password" label="Password" required>
            <div className="relative">
              <input
                id="reg-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                value={form.password}
                onChange={handleChange}
                className="input border w-full pr-10"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <FaEyeSlash className="w-4 h-4" aria-hidden /> : <FaEye className="w-4 h-4" aria-hidden />}
              </button>
            </div>
          </Field>
          <Field id="reg-confirm-password" label="Confirm password" required>
            <div className="relative">
              <input
                id="reg-confirm-password"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Re-enter password"
                value={form.confirmPassword}
                onChange={handleChange}
                className="input border w-full pr-10"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((value) => !value)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirmPassword ? <FaEyeSlash className="w-4 h-4" aria-hidden /> : <FaEye className="w-4 h-4" aria-hidden />}
              </button>
            </div>
          </Field>
        </section>

        {track.requiresAddress || track.requiresNeighborhood ? (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Location</h3>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                City
              </p>
              <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{signupCityName}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                All neighborhoods on this platform sit under this city.
              </p>
            </div>
            {track.requiresNeighborhood ? (
              <Field
                id="reg-neighborhood"
                label="Suburb / neighborhood"
                required
                hint={
                  signupOptionsLoading
                    ? "Loading available areas…"
                    : areas.length === 0
                      ? "No neighborhood areas are available to join yet."
                      : "Choose your area from the list."
                }
              >
                <select
                  id="reg-neighborhood"
                  name="neighborhoodOrganizationId"
                  value={form.neighborhoodOrganizationId}
                  onChange={handleChange}
                  className="input border w-full"
                  required
                  disabled={signupOptionsLoading || areas.length === 0}
                >
                  <option value="">
                    {signupOptionsLoading ? "Loading areas…" : "Select an area"}
                  </option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {track.requiresAddress ? (
              <Field id="reg-address" label="Home address" required>
                <input
                  id="reg-address"
                  name="address"
                  type="text"
                  autoComplete="street-address"
                  placeholder="Street address"
                  value={form.address}
                  onChange={handleChange}
                  className="input border w-full"
                  required
                />
              </Field>
            ) : null}
          </section>
        ) : null}

        {track.requiresVehicle ? (
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Patrol vehicle</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Shown on the live patrol map. Residents and security partners skip this step.
              </p>
            </div>
            <RegisterVehicleFields form={form} onChange={handleChange} />
          </section>
        ) : null}

        {track.requiresCompanyProfile ? (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Company profile</h3>
            <Field
              id="reg-listed-company"
              label="Listed company"
              hint={
                signupOptionsLoading
                  ? "Loading listed companies…"
                  : "Optional. Pick yours if it is already on the list, otherwise leave this as not listed and type the name below."
              }
            >
              <select
                id="reg-listed-company"
                name="companyOrganizationId"
                value={form.companyOrganizationId}
                onChange={handleChange}
                className="input border w-full"
                disabled={signupOptionsLoading}
              >
                <option value="">Not listed — I will type the name</option>
                {securityCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {securityCompanyOptionLabel(company)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="reg-company-name"
              label="Company name"
              required
              hint="Trading name as it should appear on the platform."
            >
              <input
                id="reg-company-name"
                name="companyName"
                type="text"
                placeholder="e.g. Tacnet"
                value={form.companyName}
                onChange={handleChange}
                className="input border w-full"
                required
              />
            </Field>
            <Field
              id="reg-company-reg"
              label="PSIRA / company registration"
              required
              hint="Used to verify the company before it is activated."
            >
              <input
                id="reg-company-reg"
                name="companyRegistration"
                type="text"
                placeholder="PSIRA or CIPC number"
                value={form.companyRegistration}
                onChange={handleChange}
                className="input border w-full"
                required
              />
            </Field>
            <Field id="reg-job-title" label="Your job title">
              <input
                id="reg-job-title"
                name="jobTitle"
                type="text"
                placeholder="e.g. Operations manager"
                value={form.jobTitle}
                onChange={handleChange}
                className="input border w-full"
              />
            </Field>
            <Field id="reg-company-address" label="Company address" required>
              <input
                id="reg-company-address"
                name="companyAddress"
                type="text"
                placeholder="Business address"
                value={form.companyAddress}
                onChange={handleChange}
                className="input border w-full"
                required
              />
            </Field>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Coverage area <span className="text-red-500" aria-hidden> *</span>
              </legend>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose the whole city, or tick every registered neighborhood you cover.
              </p>
              <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="coverageScope"
                  value="city"
                  checked={form.coverageScope === "city"}
                  onChange={handleChange}
                  className="mt-0.5 w-4 h-4"
                />
                <span>
                  <span className="font-medium">{DEFAULT_CITY_FULL_NAME} — whole city</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    All current and future neighborhoods in this city.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="coverageScope"
                  value="areas"
                  checked={form.coverageScope === "areas"}
                  onChange={handleChange}
                  className="mt-0.5 w-4 h-4"
                />
                <span>
                  <span className="font-medium">Selected neighborhoods</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    Pick one or more registered watch areas.
                  </span>
                </span>
              </label>
              {form.coverageScope === "areas" ? (
                <div className="ml-6 space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  {signupOptionsLoading ? (
                    <p className="text-xs text-gray-500">Loading neighborhoods…</p>
                  ) : areas.length === 0 ? (
                    <p className="text-xs text-gray-500">No neighborhoods are listed yet. Choose whole-city coverage instead.</p>
                  ) : (
                    areas.map((area) => {
                      const checked = (form.coverageOrganizationIds || []).includes(area.id);
                      return (
                        <label key={area.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setForm((prev) => {
                                const currentIds = prev.coverageOrganizationIds || [];
                                const nextIds = checked
                                  ? currentIds.filter((id) => id !== area.id)
                                  : [...currentIds, area.id];
                                const names = nextIds
                                  .map((id) => areas.find((row) => row.id === id)?.name)
                                  .filter(Boolean);
                                return {
                                  ...prev,
                                  coverageOrganizationIds: nextIds,
                                  coverageOrganizationId: nextIds[0] || "",
                                  coverageArea: names.join(", "),
                                };
                              });
                            }}
                            className="w-4 h-4"
                          />
                          {area.name}
                        </label>
                      );
                    })
                  )}
                </div>
              ) : null}
            </fieldset>
          </section>
        ) : null}

        {track.requiresWatchProfile ? (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Watch group</h3>
            <Field id="reg-watch-name" label="Neighborhood watch name" required>
              <input
                id="reg-watch-name"
                name="watchName"
                type="text"
                placeholder="e.g. Theescombe Neighborhood Watch"
                value={form.watchName}
                onChange={handleChange}
                className="input border w-full"
                required
              />
            </Field>
            <Field id="reg-watch-area" label="Primary suburb / area" required>
              <input
                id="reg-watch-area"
                name="watchArea"
                type="text"
                placeholder="e.g. Theescombe"
                value={form.watchArea}
                onChange={handleChange}
                className="input border w-full"
                required
              />
            </Field>
          </section>
        ) : null}

        {track.showEmergencyContact ? (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Emergency contact</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Used if staff cannot reach you. Required.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="reg-emergency-first-name" label="Contact name" required>
                <input
                  id="reg-emergency-first-name"
                  name="emergencyContactFirstName"
                  type="text"
                  placeholder="Contact name"
                  value={form.emergencyContactFirstName}
                  onChange={handleChange}
                  className="input border w-full"
                  required
                />
              </Field>
              <Field id="reg-emergency-last-name" label="Contact surname" required>
                <input
                  id="reg-emergency-last-name"
                  name="emergencyContactLastName"
                  type="text"
                  placeholder="Contact surname"
                  value={form.emergencyContactLastName}
                  onChange={handleChange}
                  className="input border w-full"
                  required
                />
              </Field>
            </div>
            <Field id="reg-emergency-phone" label="Contact phone" required>
              <input
                id="reg-emergency-phone"
                name="emergencyContactPhone"
                type="tel"
                placeholder="e.g. 082 123 4567"
                value={form.emergencyContactPhone}
                onChange={handleChange}
                className="input border w-full"
                required
              />
            </Field>
            <Field id="reg-emergency-relationship" label="Relationship">
              <select
                id="reg-emergency-relationship"
                name="emergencyContactRelationship"
                value={form.emergencyContactRelationship}
                onChange={handleChange}
                className="input border w-full"
              >
                <option value="">Prefer not to say</option>
                {EMERGENCY_CONTACT_RELATIONSHIPS.map((row) => (
                  <option key={row.value} value={row.value}>
                    {row.label}
                  </option>
                ))}
              </select>
            </Field>
          </section>
        ) : null}

        {track.showSecurityMembership ? (
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Armed response (optional)</h3>
            <Field
              id="reg-security-company"
              label="Security-company membership"
              hint={
                signupOptionsLoading
                  ? "Loading security companies…"
                  : securityCompanies.length === 0
                    ? "No security companies are listed yet."
                    : "Choose from the listed security companies, or leave as no membership."
              }
            >
              <select
                id="reg-security-company"
                name="securityCompanyId"
                value={form.securityCompanyId}
                onChange={handleChange}
                className="input border w-full"
                disabled={signupOptionsLoading}
              >
                <option value="">No membership</option>
                {securityCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {securityCompanyOptionLabel(company)}
                  </option>
                ))}
              </select>
            </Field>
          </section>
        ) : null}

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Required agreements</p>
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
          {track.requiresSop ? (
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
          ) : null}
          {track.requiresPartnerAgreement ? (
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedPartner}
                onChange={(e) => setAcceptedPartner(e.target.checked)}
                className="mt-0.5 w-4 h-4"
                required
              />
              <span>
                I confirm I am authorised to register this security company and accept the partner operating agreement.
              </span>
            </label>
          ) : null}
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

        {error ? (
          <p className="text-red-600 dark:text-red-400 text-sm text-center" role="alert">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={
            loading ||
            (track.requiresNeighborhood && (signupOptionsLoading || areas.length === 0))
          }
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? "Registering…" : `Register as ${track.label}`}
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
