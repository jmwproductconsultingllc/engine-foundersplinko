// Run from fdd-engine-deploy/ :  node count-item19.js
const fs = require("fs"), path = "data/brands";
const find = (o, key) => {
  if (!o || typeof o !== "object") return undefined;
  for (const k of Object.keys(o)) {
    if (k.toLowerCase() === key) return o[k];
    const r = find(o[k], key);
    if (r !== undefined) return r;
  }
};
let total = 0, noClaim = 0, hasClaim = 0, unknown = 0;
const unknowns = [];
for (const f of fs.readdirSync(path).filter(x => x.endsWith(".json"))) {
  let j; try { j = JSON.parse(fs.readFileSync(`${path}/${f}`, "utf8")); } catch { continue; }
  total++;
  const v = find(j, "hasitem19");
  if (v === false) noClaim++;
  else if (v === true) hasClaim++;
  else { unknown++; unknowns.push(f); }
}
const known = noClaim + hasClaim;
console.log(`records on disk      ${total}`);
console.log(`Item 19 present      ${hasClaim}`);
console.log(`NO earnings claim    ${noClaim}`);
console.log(`flag missing/null    ${unknown}`);
console.log(`--> share with NO earnings claim: ${known ? (noClaim / known * 100).toFixed(1) : "n/a"}%  (of ${known} filings where the flag was recorded)`);
if (unknowns.length) console.log(`\nmissing flag in:\n  ${unknowns.join("\n  ")}`);
