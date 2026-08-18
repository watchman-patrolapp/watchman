const TOKEN_PALETTE = {
  "brand.blue.600": "#2563eb",
  "brand.blue.100": "#dbeafe",
  "brand.green.600": "#16a34a",
  "brand.green.100": "#dcfce7",
  "brand.red.600": "#dc2626",
  "brand.red.100": "#fee2e2",
  "brand.purple.600": "#9333ea",
  "brand.purple.100": "#f3e8ff",
  "brand.slate.700": "#334155",
  "brand.slate.100": "#f1f5f9",
};

function resolveToken(token, fallback) {
  return TOKEN_PALETTE[token] || fallback;
}

export function resolveSecurityCardColors(branding = {}) {
  const primary = resolveToken(branding.primary_color_token, "#2563eb");
  const secondary = resolveToken(branding.secondary_color_token, "#dbeafe");
  const cardStyle = branding.card_style || "solid";

  if (cardStyle === "outlined") {
    return {
      background: "#ffffff",
      borderColor: primary,
      textColor: primary,
      accent: secondary,
    };
  }

  if (cardStyle === "gradient") {
    return {
      background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
      borderColor: primary,
      textColor: "#ffffff",
      accent: "rgba(255,255,255,0.15)",
    };
  }

  return {
    background: secondary,
    borderColor: primary,
    textColor: "#0f172a",
    accent: primary,
  };
}
