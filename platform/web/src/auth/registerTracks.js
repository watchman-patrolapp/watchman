/**
 * Public self-signup tracks. Privileged roles (admin, technical_support,
 * city_admin, investigator, committee) stay invite-only.
 */

export const REGISTER_TRACKS = [
  {
    id: "resident",
    appRole: "resident",
    label: "Resident",
    tagline: "Home safety, SOS, and activity reports",
    description:
      "For people who live in the area. Report activity, send SOS, and stay informed. No patrol vehicle needed.",
    cta: "Continue as resident",
    requiresVehicle: false,
    requiresAddress: true,
    requiresNeighborhood: true,
    requiresSop: false,
    requiresPartnerAgreement: false,
    showSecurityMembership: true,
    requiresCompanyProfile: false,
    requiresWatchProfile: false,
    showEmergencyContact: true,
  },
  {
    id: "patroller",
    appRole: "patroller",
    label: "Patroller",
    tagline: "Join patrols, live map, and incident response",
    description:
      "For neighborhood watch members who patrol. Vehicle or patrol-mode details are required for the live map.",
    cta: "Continue as patroller",
    requiresVehicle: true,
    requiresAddress: true,
    requiresNeighborhood: true,
    requiresSop: true,
    requiresPartnerAgreement: false,
    showSecurityMembership: false,
    requiresCompanyProfile: false,
    requiresWatchProfile: false,
    showEmergencyContact: true,
  },
  {
    id: "security_company",
    appRole: "security_admin",
    label: "Security company",
    tagline: "Partner response and member verification",
    description:
      "For private security companies partnering with neighborhood watches. Company registration details are required; patrol vehicles are not.",
    cta: "Continue as security partner",
    requiresVehicle: false,
    requiresAddress: false,
    requiresNeighborhood: false,
    requiresSop: false,
    requiresPartnerAgreement: true,
    showSecurityMembership: false,
    requiresCompanyProfile: true,
    requiresWatchProfile: false,
    showEmergencyContact: false,
  },
  {
    id: "neighborhood_watch",
    appRole: "nw_admin",
    label: "Neighborhood Watch",
    tagline: "Register or lead a local watch group",
    description:
      "For committee leads setting up a neighborhood watch. Your group is reviewed before it goes live. Vehicle details can be added later.",
    cta: "Continue as watch admin",
    requiresVehicle: false,
    requiresAddress: true,
    requiresNeighborhood: false,
    requiresSop: true,
    requiresPartnerAgreement: false,
    showSecurityMembership: false,
    requiresCompanyProfile: false,
    requiresWatchProfile: true,
    showEmergencyContact: true,
  },
];

export const REGISTER_TRACK_IDS = REGISTER_TRACKS.map((track) => track.id);

export function getRegisterTrack(id) {
  if (!id) return null;
  const key = String(id).trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  const aliases = {
    patrol: "patroller",
    volunteer: "patroller",
    security: "security_company",
    security_admin: "security_company",
    nw: "neighborhood_watch",
    nw_admin: "neighborhood_watch",
    watch: "neighborhood_watch",
    user: "resident",
  };
  const resolved = aliases[key] || key;
  return REGISTER_TRACKS.find((track) => track.id === resolved) || null;
}

export function formatPersonName(firstName, lastName) {
  return [firstName, lastName]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function emptyRegisterForm() {
  return {
    firstName: "",
    lastName: "",
    address: "",
    neighborhoodOrganizationId: "",
    neighborhoodName: "",
    vehicleType: "car",
    carType: "",
    regNumber: "",
    vehicleColor: "gray",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
    emergencyContactFirstName: "",
    emergencyContactLastName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "",
    securityMembership: "prefer_not_to_say",
    securityCompanyId: "",
    securityCompanyName: "",
    securityMembershipReference: "",
    companyName: "",
    companyOrganizationId: "",
    companyRegistration: "",
    companyAddress: "",
    coverageArea: "",
    coverageOrganizationId: "",
    coverageOrganizationIds: [],
    coverageScope: "",
    jobTitle: "",
    watchName: "",
    watchArea: "",
  };
}

export function validateRegisterForm(track, form) {
  if (!track) return "Choose how you want to join.";

  const firstName = form.firstName.trim();
  const lastName = form.lastName.trim();
  if (!firstName) return "Name is required.";
  if (!lastName) return "Surname is required.";

  const phone = form.phone.trim();
  if (!phone) return "Phone number is required.";
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 10) return "Enter a valid phone number (at least 10 digits).";

  const email = form.email.trim();
  if (!email) return "Email address is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";

  if (!form.password || form.password.length < 6) {
    return "Password should be at least 6 characters";
  }
  if (form.password !== form.confirmPassword) {
    return "Passwords do not match.";
  }

  if (track.requiresAddress && !form.address.trim()) {
    return "Home address is required.";
  }

  if (track.requiresNeighborhood && !form.neighborhoodOrganizationId) {
    return "Please choose a suburb / neighborhood from the list.";
  }

  if (track.showEmergencyContact && form.emergencyContactPhone.trim()) {
    const emergencyDigits = form.emergencyContactPhone.replace(/\D/g, "");
    if (emergencyDigits.length < 10) {
      return "Enter a valid emergency contact number, or leave it blank.";
    }
  }

  if (track.showSecurityMembership && form.securityCompanyId && !form.securityCompanyName.trim()) {
    return "Please choose a security company from the list.";
  }

  if (track.requiresCompanyProfile) {
    if (!form.companyName.trim()) return "Company name is required.";
    if (!form.companyRegistration.trim()) {
      return "PSIRA or company registration number is required.";
    }
    if (!form.companyAddress.trim()) return "Company address is required.";
    if (form.coverageScope === "city") {
      // Whole-city coverage is valid without picking neighborhoods.
    } else if (form.coverageScope === "areas") {
      if (!Array.isArray(form.coverageOrganizationIds) || form.coverageOrganizationIds.length === 0) {
        return "Select at least one neighborhood, or choose whole-city coverage.";
      }
    } else {
      return "Choose whole-city coverage or one or more neighborhoods.";
    }
  }

  if (track.requiresWatchProfile) {
    if (!form.watchName.trim()) return "Neighborhood watch name is required.";
    if (!form.watchArea.trim()) return "Watch area or suburb is required.";
  }

  return "";
}
