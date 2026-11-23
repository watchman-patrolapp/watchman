// GeoNames South Africa -> Watchman city/town reference list. Pure functions only.
// Licence of the source data: CC BY 4.0, "Place names © GeoNames (geonames.org)".

/** GeoNames admin1 code -> ISO 3166-2:ZA. */
export const PROVINCES = {
  "02": { code: "ZA-KZN", name: "KwaZulu-Natal" },
  "03": { code: "ZA-FS", name: "Free State" },
  "05": { code: "ZA-EC", name: "Eastern Cape" },
  "06": { code: "ZA-GP", name: "Gauteng" },
  "07": { code: "ZA-MP", name: "Mpumalanga" },
  "08": { code: "ZA-NC", name: "Northern Cape" },
  "09": { code: "ZA-LP", name: "Limpopo" },
  "10": { code: "ZA-NW", name: "North West" },
  "11": { code: "ZA-WC", name: "Western Cape" },
};

/** Populated-place codes that become cities/towns. Everything else is dropped. */
export const INCLUDE_CODES = new Set(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG", "PPLL"]);
/** Never a city: municipality / district / ward wording. */
export const MUNICIPALITY_WORDS = /\b(municipality|metropolitan|metro|district|local council|ward\s*\d+)\b/i;
/** Languages whose alternate names are useful search aliases in South Africa. '' = unspecified. */
export const ALIAS_LANGS = new Set(["", "en", "af", "zu", "xh", "st", "tn", "nso", "ts", "ss", "ve", "nr"]);

// Same table as public.place_name_key() in SQL. Keep them identical.
const FROM = "áàâäãåāăąéèêëēėęíìîïīįóòôöõøōúùûüūųýÿñńçćčšśžźżđ";
const TO = "aaaaaaaaaeeeeeeeiiiiiiooooooouuuuuuyynncccsszzzd";

/** lower, drop a trailing "(...)", fold accents, drop apostrophes, non a-z0-9 -> space, collapse. */
export function nameKey(input) {
  let s = String(input ?? "").toLowerCase().trim();
  s = s.replace(/\s*\([^)]*\)\s*$/, "");
  let out = "";
  for (const ch of s) {
    const i = FROM.indexOf(ch);
    out += i >= 0 ? TO[i] : ch;
  }
  out = out.replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/œ/g, "oe");
  out = out.replace(/['’`‘]/g, "");
  out = out.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return out;
}

/** Latin-script check on the raw text (after accent folding the key must be non-empty). */
export function isLatin(text) {
  return /^[\p{Script=Latin}0-9 .,'’`‘()\-/&]+$/u.test(String(text ?? ""));
}

export function parseGeonames(tsv) {
  const rows = [];
  for (const line of String(tsv).split("\n")) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    rows.push({
      id: Number(c[0]),
      name: c[1],
      ascii: c[2],
      alternates: c[3] ? c[3].split(",") : [],
      lat: Number(c[4]),
      lng: Number(c[5]),
      fclass: c[6],
      fcode: c[7],
      country: c[8],
      admin1: c[10],
      admin2: c[11],
      population: Number(c[14] || 0),
    });
  }
  return rows;
}

/** alternateNames rows: id -> [{name, lang, preferred, short, colloquial, historic}] */
export function parseAlternates(tsv) {
  const map = new Map();
  for (const line of String(tsv).split("\n")) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    const gid = Number(c[1]);
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid).push({
      name: c[3],
      lang: c[2] || "",
      preferred: c[4] === "1",
      short: c[5] === "1",
      colloquial: c[6] === "1",
      historic: c[7] === "1",
    });
  }
  return map;
}

export function distanceKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function placeType(p) {
  if (p.fcode === "PPLC" || p.fcode === "PPLA" || p.fcode === "PPLA2" || p.population >= 100000) return "city";
  if (p.fcode === "PPLL") return "locality";
  if (p.fcode === "PPLA3" || p.fcode === "PPLA4" || p.population >= 5000) return "town";
  return "village";
}

/**
 * Build the reference list.
 * @returns {{ places: object[], aliases: object[], dropped: object[], renamed: object[], sharesAdminName: object[], stats: object }}
 */
export function buildPlaces(rows, { alternates = new Map(), renames = [], notPlaces = [], dedupeKm = 15 } = {}) {
  const dropped = [];
  const drop = (p, reason) => dropped.push({ id: p.id, name: p.name, fcode: `${p.fclass}.${p.fcode}`, province: PROVINCES[p.admin1]?.code || p.admin1, reason });

  // Admin-area names per province (municipalities, districts), for the municipality guard.
  const adminNames = new Map();
  for (const r of rows) {
    if (r.country !== "ZA" || r.fclass !== "A") continue;
    const key = `${r.admin1}|${nameKey(r.name)}`;
    adminNames.set(key, true);
  }

  let places = [];
  for (const r of rows) {
    if (r.country !== "ZA") continue;
    if (r.fclass !== "P") continue; // admin areas, farms, stations, ports, suburbs-as-spots...
    if (!INCLUDE_CODES.has(r.fcode)) { drop(r, `feature ${r.fcode} not a city or town`); continue; }
    if (!PROVINCES[r.admin1]) { drop(r, "no province"); continue; }
    if (MUNICIPALITY_WORDS.test(r.name)) { drop(r, "municipality wording"); continue; }
    if (!nameKey(r.name)) { drop(r, "empty name"); continue; }
    places.push({ ...r, province: PROVINCES[r.admin1].code, aliasSet: new Map() });
  }

  // Municipality guard. GeoNames keeps a few plain points named after a local municipality
  // (e.g. "Mogale City"). Those listed in exclusions.json are dropped; other points that share a
  // municipality name (real towns such as Richmond or Nongoma) are kept and listed for review.
  const excluded = new Set(notPlaces.map((x) => `${x.province}|${nameKey(x.name)}`));
  const sharesAdminName = [];
  places = places.filter((p) => {
    const key = `${p.province}|${nameKey(p.name)}`;
    if (excluded.has(key) && p.population === 0) {
      drop(p, "municipality name, not a town (exclusions.json)");
      return false;
    }
    if (adminNames.has(`${p.admin1}|${nameKey(p.name)}`)) sharesAdminName.push({ id: p.id, name: p.name, province: p.province });
    return true;
  });

  const addAlias = (p, alias, kind) => {
    const key = nameKey(alias);
    if (!key || key === nameKey(p.name) || key.length < 2) return;
    const prev = p.aliasSet.get(key);
    if (!prev || (kind === "old_name" && prev.kind !== "old_name")) p.aliasSet.set(key, { alias: alias.trim(), kind });
  };

  // Official renames.
  const byId = new Map(places.map((p) => [p.id, p]));
  const renamed = [];
  for (const r of renames) {
    if (!r.apply) continue;
    const p = byId.get(r.geonames_id);
    if (!p) { renamed.push({ ...r, result: "geonames id not found" }); continue; }
    if (p.province !== r.province) { renamed.push({ ...r, result: `province mismatch (${p.province})` }); continue; }
    const before = p.name;
    if (before !== r.official) {
      addAlias(p, before, "old_name");
      p.name = r.official;
    }
    p.official = true;
    for (const f of r.former || []) addAlias(p, f, "old_name");
    renamed.push({ ...r, result: before === r.official ? "already official" : `renamed from ${before}` });
  }

  // Alternate names (South African languages, Latin script). Historic ones count as old names.
  const formerKeys = new Set(renames.filter((r) => r.apply).flatMap((r) => (r.former || []).map(nameKey)));
  for (const p of places) {
    for (const a of alternates.get(p.id) || []) {
      if (!ALIAS_LANGS.has(a.lang)) continue;
      if (!isLatin(a.name) || /^[A-Z]{2,5}$/.test(a.name)) continue; // codes like PLZ, ZAGRH
      if (MUNICIPALITY_WORDS.test(a.name)) continue;
      addAlias(p, a.name, a.historic || formerKeys.has(nameKey(a.name)) ? "old_name" : "alternate");
    }
  }

  // Duplicate old-name points: an unpopulated place whose name is a former/alternate name of a bigger
  // kept place in the same province, within dedupeKm, is folded into it as an alias.
  const sorted = [...places].sort((a, b) => b.population - a.population);
  const removed = new Set();
  for (const small of places) {
    if (small.population > 0 || removed.has(small.id)) continue;
    const key = nameKey(small.name);
    const host = sorted.find(
      (big) =>
        big.id !== small.id &&
        !removed.has(big.id) &&
        big.population > 0 &&
        big.province === small.province &&
        big.aliasSet.has(key) &&
        distanceKm(big, small) <= dedupeKm,
    );
    if (host) {
      removed.add(small.id);
      addAlias(host, small.name, host.aliasSet.get(key)?.kind || "alternate");
      drop(small, `old-name point folded into ${host.name} (${host.id})`);
    }
  }
  // Exact repeats: the same name in the same province within dedupeKm is one place. Keep the
  // official (renamed) one, then the populated one, then the admin seat, then the lowest id.
  const rank = (p) => [p.official ? 1 : 0, p.population, p.fcode.startsWith("PPLA") || p.fcode === "PPLC" ? 1 : 0, -p.id];
  const better = (a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i];
    return false;
  };
  const byKey = new Map();
  for (const p of places) {
    if (removed.has(p.id)) continue;
    const k = `${p.province}|${nameKey(p.name)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    for (const a of list) {
      if (removed.has(a.id)) continue;
      for (const b of list) {
        if (a === b || removed.has(b.id) || removed.has(a.id) || distanceKm(a, b) > dedupeKm) continue;
        const [keep, lose] = better(a, b) ? [a, b] : [b, a];
        removed.add(lose.id);
        if (lose.name !== keep.name) addAlias(keep, lose.name, "alternate");
        for (const [k, v] of lose.aliasSet) if (!keep.aliasSet.has(k)) keep.aliasSet.set(k, v);
        if (!keep.population && lose.population) keep.population = lose.population;
        drop(lose, `repeat of ${keep.name} (${keep.id}) within ${dedupeKm} km`);
      }
    }
  }
  places = places.filter((p) => !removed.has(p.id));

  // An alias that is another kept place's own name in the same province is ambiguous: drop it.
  const ownNames = new Set(places.map((p) => `${p.province}|${nameKey(p.name)}`));
  for (const p of places) {
    for (const [key, a] of p.aliasSet) {
      if (a.kind !== "old_name" && ownNames.has(`${p.province}|${key}`)) p.aliasSet.delete(key);
    }
  }

  // Disambiguation for repeated names in one province: "near <closest town of 5 000+>".
  const groups = new Map();
  for (const p of places) {
    const k = `${p.province}|${nameKey(p.name)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const anchors = places.filter((p) => p.population >= 5000);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const p of list) {
      let best = null, bestD = Infinity;
      for (const a of anchors) {
        if (a.id === p.id || a.province !== p.province || nameKey(a.name) === nameKey(p.name)) continue;
        const d = distanceKm(p, a);
        if (d < bestD) { bestD = d; best = a; }
      }
      p.near = best ? `near ${best.name}` : null;
    }
    const seen = new Map();
    for (const p of list.sort((a, b) => b.population - a.population || a.id - b.id)) {
      const label = p.near || "";
      const n = (seen.get(label) || 0) + 1;
      seen.set(label, n);
      if (n > 1) p.near = `${label ? label + " " : ""}(${n})`.trim();
    }
  }

  const out = places
    .map((p) => ({
      geonames_id: p.id,
      name: p.name,
      name_key: nameKey(p.name),
      province_code: p.province,
      place_type: placeType(p),
      feature_code: p.fcode,
      population: p.population,
      lat: p.lat,
      lng: p.lng,
      near_label: p.near || null,
    }))
    .sort((a, b) => b.population - a.population || a.geonames_id - b.geonames_id);
  const aliases = [];
  for (const p of places) {
    for (const [key, a] of p.aliasSet) aliases.push({ geonames_id: p.id, alias: a.alias, alias_key: key, kind: a.kind });
  }
  aliases.sort((a, b) => a.geonames_id - b.geonames_id || a.alias_key.localeCompare(b.alias_key));

  const stats = {
    source_rows: rows.length,
    places: out.length,
    aliases: aliases.length,
    old_name_aliases: aliases.filter((a) => a.kind === "old_name").length,
    dropped: dropped.length,
    with_population: out.filter((p) => p.population > 0).length,
    by_province: Object.fromEntries(Object.values(PROVINCES).map((v) => [v.code, out.filter((p) => p.province_code === v.code).length])),
    by_type: out.reduce((m, p) => ((m[p.place_type] = (m[p.place_type] || 0) + 1), m), {}),
    disambiguated: out.filter((p) => p.near_label).length,
  };
  return { places: out, aliases, dropped, renamed, sharesAdminName, stats };
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

/** Reads a CSV written by toCsv() back into objects (quoted fields, doubled quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  const s = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1 || r[0] !== "").map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
