// Bakes an export from the god's-eye editor into the film.
// Usage: node tools/apply-overrides.cjs path/to/clockwork-edits.json
//   shot camera keyframes -> const SHOT_OVERRIDES
//   colour grade          -> const DIRECTOR_GRADE (and a "Director's grade" entry in the grade menu)
// Then rebuild the viewer with: npm run build:godview
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'Clockwork_Firefly_fullfilm.html');
const src = process.argv[2];
if (!src) { console.error('usage: node tools/apply-overrides.cjs <edits.json>'); process.exit(1); }
const edits = JSON.parse(fs.readFileSync(src, 'utf8'));
let html = fs.readFileSync(file, 'utf8');
const swap = (name, value) => {
  const re = new RegExp(`/\\*${name}-BEGIN\\*/[\\s\\S]*?/\\*${name}-END\\*/`);
  if (!re.test(html)) throw new Error(`marker ${name} not found in the film`);
  html = html.replace(re, () => `/*${name}-BEGIN*/${JSON.stringify(value)}/*${name}-END*/`);
};
const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);
const ov = round(edits.overrides || {});
swap('OVERRIDES', ov);
if (edits.grade) {
  swap('GRADE', round(edits.grade));
  if (!html.includes('value="directorgrade"')) html = html.replace('<select id="selGrade" aria-label="Color grade">\n', '<select id="selGrade" aria-label="Color grade">\n      <option value="directorgrade" selected>Director\'s grade</option>\n');
}
fs.writeFileSync(file, html);
console.log(`baked ${Object.keys(ov).length} shot override(s)${edits.grade ? ' and the director\'s grade' : ''} into ${path.basename(file)}`);
