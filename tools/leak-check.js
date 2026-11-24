// Stops personal details from being shared.
//
//   node tools/leak-check.js --staged      check files staged for commit (used by the git pre-commit hook)
//   node tools/leak-check.js <dir>         check every file under a folder (used by package.js)
//
// Looks for the name, email, phone, file prefix, sheet ID and street address from user/profile.json
// and user/resume.json, and blocks any staged file inside user/ or applications-*/.
// Exits 1 (and prints what it found) if anything personal turns up.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return {}; } };

function needles() {
  const p = readJson('user/profile.json');
  const r = readJson('user/resume.json');
  const list = [p.spreadsheetId, p.filePrefix, p.name, r.name, r.email, r.phone];
  // Each part of the contact line (suburb, LinkedIn URL, email, phone), but not short or generic bits.
  if (r.contact) list.push(...r.contact.split('|').map((s) => s.trim()));
  if (r.name) list.push(...r.name.split(/\s+/).filter((w) => w.length >= 4));
  // Anything that also appears in the shipped templates is a placeholder, not personal (e.g. "Full Name").
  let templates = '';
  for (const t of ['templates/resume.template.json', 'templates/profile.template.json']) {
    try { templates += fs.readFileSync(path.join(ROOT, t), 'utf8').toLowerCase(); } catch { /* not there */ }
  }
  return [...new Set(list.filter((s) => typeof s === 'string' && s.length >= 4 && !templates.includes(s.toLowerCase())))];
}

const BLOCKED_PATHS = [/^user\//, /^applications-[^/]*\//, /^archive\//, /^interviews\//];

function check(files, read) {
  const n = needles();
  const found = [];
  for (const f of files) {
    const rel = f.replace(/\\/g, '/');
    if (BLOCKED_PATHS.some((re) => re.test(rel))) { found.push(`${rel}: personal folder, must not be shared`); continue; }
    let text;
    try { text = read(f); } catch { continue; }
    if (text.includes('\u0000')) continue; // binary
    for (const s of n) if (text.toLowerCase().includes(s.toLowerCase())) found.push(`${rel}: contains "${s}"`);
  }
  return found;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') out.push(...walk(p)); } else out.push(p);
  }
  return out;
}

function run(arg) {
  if (arg === '--staged') {
    const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    return check(files, (f) => execFileSync('git', ['show', `:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }));
  }
  const dir = path.resolve(arg || ROOT);
  return check(walk(dir).map((f) => path.relative(dir, f)), (f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

module.exports = { run };

if (require.main === module) {
  const found = run(process.argv[2]);
  if (found.length) {
    console.error('BLOCKED: personal details found.\n  ' + found.join('\n  ') + '\nRemove them, then try again.');
    process.exit(1);
  }
  console.log('Leak check passed: no personal details found.');
}
