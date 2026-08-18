const memory = new Map();

function storageKey(userId) {
  return `nwp.securityBrand.${userId}`;
}

export function readSecurityCompanyBrand(userId) {
  if (!userId) return { name: "", logoUrl: "" };
  const cached = memory.get(userId);
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { name: "", logoUrl: "" };
    const parsed = JSON.parse(raw);
    const brand = {
      name: String(parsed?.name || "").trim(),
      logoUrl: String(parsed?.logoUrl || "").trim(),
    };
    memory.set(userId, brand);
    return brand;
  } catch {
    return { name: "", logoUrl: "" };
  }
}

export function writeSecurityCompanyBrand(userId, { name, logoUrl }) {
  if (!userId) return;
  const brand = {
    name: String(name || "").trim(),
    logoUrl: String(logoUrl || "").trim(),
  };
  memory.set(userId, brand);
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(brand));
  } catch {
    /* ignore quota / private mode */
  }
}
