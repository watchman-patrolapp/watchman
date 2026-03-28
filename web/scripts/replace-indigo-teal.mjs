import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, "..", "src");

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(jsx|js|css)$/.test(ent.name)) {
      let c = fs.readFileSync(p, "utf8");
      const o = c;
      c = c.replace(/indigo-(\d+(?:\/[\d.]+)?)/g, "teal-$1");
      if (c !== o) {
        fs.writeFileSync(p, c);
        console.log("updated", path.relative(srcRoot, p));
      }
    }
  }
}

walk(srcRoot);
