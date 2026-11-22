# GeoNames South Africa → Watchman cities and towns

Builds the reference list of South African cities, towns and villages that members pick from.
Phase P0 of the SA places plan: this folder only produces files; it changes no database.

## Source and licence

- `https://download.geonames.org/export/dump/ZA.zip` (places) and
  `https://download.geonames.org/export/dump/alternatenames/ZA.zip` (alternate names).
- Licence: **Creative Commons Attribution 4.0**. Show this credit wherever the list is used
  (About / legal page, and the seed SQL header):
  **"Place names © GeoNames (geonames.org), CC BY 4.0."**
- The downloads are not committed. `out/` is generated and ignored.

## Run

```bash
# unzip both downloads into one folder; rename the alternate-names ZA.txt to alt-ZA.txt
node platform/supabase/tools/geonames-za/build.mjs --src <folder> [--out <folder>]
node --test platform/supabase/tools/geonames-za/__tests__/lib.test.mjs
```

Writes `places.csv`, `aliases.csv`, `dropped.csv`, `meta.json` and `report.md`.

## Rules

| Step | Rule |
|---|---|
| Keep | GeoNames class P with code PPL, PPLA, PPLA2, PPLA3, PPLA4, PPLC, PPLG or PPLL |
| Drop | Every class A row (provinces, districts, municipalities such as Nelson Mandela Bay), PPLX (suburbs: members create those), PPLF, PPLH, PPLQ, PPLR, PPLW, STLMT, and all spots, farms, stations, ports |
| Municipality names | Names with municipality / metropolitan / district / ward wording are dropped. Points that only repeat a local-municipality name (e.g. "Mogale City") are listed in `exclusions.json` (reviewed). Real towns that share a municipality name (Richmond, Nongoma, KwaDukuza…) are kept and listed in the report for review |
| Official names | `renames.json` (reviewed, with gazette references). The official name becomes primary and the former name an `old_name` alias, e.g. Grahamstown → Makhanda, Queenstown → Komani, Mafikeng → Mahikeng. `apply: false` entries are documented only (Louis Trichardt / Makhado) |
| Aliases | Old names from renames; GeoNames alternate names in South African languages (en, af, zu, xh, st, tn, nso, ts, ss, ve, nr or unspecified), Latin script only; no airport/UN codes; no alias that is another town's own name in the same province |
| Duplicates | An unpopulated point named after a bigger place's old/alternate name within 15 km is folded into it (Witbank → eMalahleni). The same name twice in one province within 15 km is one place |
| Repeated names | Same name, same province, further apart: each gets "near <closest town of 5 000+>" (e.g. Middelburg near Steynsburg) |
| Ranking | Population (descending); `place_type` is city / town / village / locality |

`nameKey()` in `lib.mjs` must stay identical to `public.place_name_key()` in the P1 migration; the
PGlite test for P1 compares both on every generated name.
