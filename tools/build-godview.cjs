// Builds Clockwork_Firefly_godview.html: the film plus the injected director's desk (god's-eye editor).
// Usage: node tools/build-godview.cjs   (re-run after editing the film or anything in tools/godview.*)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'Clockwork_Firefly_fullfilm.html'), 'utf8');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const must = (cond, msg) => { if (!cond) throw new Error('build-godview: ' + msg); };

// extra three.js addons the desk needs
const imp = "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';";
must(html.includes(imp), 'OrbitControls import not found');
html = html.replace(imp, imp + "\nimport { TransformControls } from 'three/addons/controls/TransformControls.js';\nimport { Line2 } from 'three/addons/lines/Line2.js';\nimport { LineMaterial } from 'three/addons/lines/LineMaterial.js';\nimport { LineGeometry } from 'three/addons/lines/LineGeometry.js';");

// the film sizes itself to the window; inside the desk it sizes itself to the viewport cell
const rs = html.indexOf('const resize = () => {'); must(rs > 0, 'resize() not found');
const re = html.indexOf('\n  };', rs); must(re > rs, 'end of resize() not found');
const body = html.slice(rs, re).replace(/innerWidth/g, '(GV_VIEW.w || innerWidth)').replace(/innerHeight/g, '(GV_VIEW.h || innerHeight)');
html = html.slice(0, rs) + body + html.slice(re);

// shot notes: the "// NAME — description" comment above each shot in the source
const shotsStart = html.indexOf('const SHOTS = ['); const shotsEnd = html.indexOf('\n];', shotsStart);
const notes = {}; let pending = [];
for (const line of html.slice(shotsStart, shotsEnd).split('\n')) {
  const c = line.match(/^\s*\/\/\s*(.+)$/), s = line.match(/^\s*\{ t0: ([\d.]+)/);
  if (c) pending.push(c[1].trim()); else if (s) { if (pending.length) notes[parseFloat(s[1])] = pending.join(' '); pending = []; } else if (/^\s*\/\*/.test(line)) pending = [];
}
const inject = [read('godview.inject.js').replace('/*__GV_NOTES__*/{}', JSON.stringify(notes)), read('godview.timeline.js')].join('\n');

const hook = /(window\.__film = \{[^}]*\};)/;
must(hook.test(html), '__film assignment not found');
html = html.replace(hook, '$1\n  godViewInstall(window.__film);');
const boot = "setTimeout(() => {\n  boot()";
must(html.includes(boot), 'boot call not found');
html = html.replace(boot, inject + '\n' + boot);
html = html.replace('<title>Clockwork Firefly</title>', "<title>Clockwork Firefly: Director's desk</title>");
html = html.replace('</head>', `<style>\n${read('godview.css')}\n</style>\n</head>`);
html = html.replace('</body>', `${read('godview.ui.html')}\n</body>`);
const out = path.join(root, 'Clockwork_Firefly_godview.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB,', Object.keys(notes).length, 'shot notes');
