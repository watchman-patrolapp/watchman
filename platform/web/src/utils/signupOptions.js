import { supabase } from "../supabase/client";
import { DEFAULT_CITY_FULL_NAME } from "../config/neighborhoodRegions";

function sortByName(list) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function asOptionList(value) {
  if (!Array.isArray(value)) return [];
  return sortByName(
    value
      .map((row) => ({
        id: String(row?.id || "").trim(),
        name: String(row?.name || "").trim(),
        status: String(row?.status || "").trim(),
        psiraReg: String(row?.psira_reg || "").trim(),
        partnerNote: String(row?.partner_note || "").trim(),
      }))
      .filter((row) => row.id && row.name)
  );
}

export function securityCompanyOptionLabel(company) {
  const name = String(company?.name || "").trim();
  if (!name) return "";
  const extras = [];
  if (company?.psiraReg) extras.push(`PSIRA ${company.psiraReg}`);
  else if (company?.partnerNote) extras.push(company.partnerNote);
  if (String(company?.status || "").toLowerCase() === "pending") extras.push("pending");
  return extras.length ? `${name} · ${extras.join(" · ")}` : name;
}

export async function loadPublicSignupOptions() {
  const { data, error } = await supabase.rpc("list_public_signup_options");
  if (error) throw error;
  const payload = data && typeof data === "object" ? data : {};
  const city =
    payload.city && typeof payload.city === "object" && payload.city.name
      ? { id: payload.city.id || null, name: String(payload.city.name) }
      : { id: null, name: DEFAULT_CITY_FULL_NAME };
  return {
    city,
    areas: asOptionList(payload.areas),
    securityCompanies: asOptionList(payload.security_companies),
  };
}
