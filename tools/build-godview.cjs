// Builds Clockwork_Firefly_godview.html: the film plus an injected god's-eye viewer.
// Usage: node tools/build-godview.cjs   (re-run after editing the film or tools/godview.inject.js)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'Clockwork_Firefly_fullfilm.html'), 'utf8');
const inject = fs.readFileSync(path.join(__dirname, 'godview.inject.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, 'godview.ui.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'godview.css'), 'utf8');
const must = (cond, msg) => { if (!cond) throw new Error('build-godview: ' + msg); };
const imp = "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';";
must(html.includes(imp), 'OrbitControls import not found');
html = html.replace(imp, imp + "\nimport { Line2 } from 'three/addons/lines/Line2.js';\nimport { LineMaterial } from 'three/addons/lines/LineMaterial.js';\nimport { LineGeometry } from 'three/addons/lines/LineGeometry.js';");
const hook = /(window\.__film = \{[^}]*\};)/;
must(hook.test(html), '__film assignment not found');
html = html.replace(hook, '$1\n  godViewInstall(window.__film);');
const boot = "setTimeout(() => {\n  boot()";
must(html.includes(boot), 'boot call not found');
html = html.replace(boot, inject + '\n' + boot);
html = html.replace('<title>Clockwork Firefly</title>', "<title>Clockwork Firefly: God's-eye view</title>");
html = html.replace('</head>', `<style>\n${css}\n</style>\n</head>`);
html = html.replace('</body>', `${ui}\n</body>`);
const out = path.join(root, 'Clockwork_Firefly_godview.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB');
