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
  if (r.name) list.push(...r.name.split(/\s+/).filter((w) => w.length >= 3));
  // Values left exactly as the template's placeholders (e.g. "Full Name", "Full", "you@example.com") aren't personal.
  const placeholders = new Set();
  const collect = (v) => {
    if (typeof v === 'string') {
      placeholders.add(v.trim().toLowerCase());
      for (const part of v.split('|')) placeholders.add(part.trim().toLowerCase());
    } else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  for (const t of ['templates/resume.template.json', 'templates/profile.template.json']) {
    try {
      const tj = JSON.parse(fs.readFileSync(path.join(ROOT, t), 'utf8'));
      collect(tj);
      if (tj.name) tj.name.split(/\s+/).forEach((w) => placeholders.add(w.toLowerCase()));
    } catch { /* not there */ }
  }
  return [...new Set(list.filter((s) => typeof s === 'string' && s.trim().length >= 3 && !placeholders.has(s.trim().toLowerCase())))];
}

// Whole-word, case-insensitive match, so part of a name never matches inside a longer ordinary word.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (s) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(s.trim())}(?![A-Za-z0-9])`, 'i');

const BLOCKED_PATHS = [/^user\//, /^applications-[^/]*\//, /^archive\//, /^interviews\//];
// Generated documents can't be read for personal details (they're binary), and they hold a whole resume or
// cover letter, so they're never shared wherever they are. Same for match reports.
const BLOCKED_FILES = [/\.(docx?|pdf|odt|rtf|pages)$/i, /(^|\/)MATCH_[^/]*\.md$/i];

// Phone numbers compared by digits only, so "0400 111 222", "0400111222" and "+61 400 111 222" all match.
const phoneCore = (s) => {
  let d = String(s).replace(/\D/g, '');
  if (d.startsWith('61')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
};
function phoneCores() {
  const r = readJson('user/resume.json');
  const parts = [r.phone, ...(r.contact ? r.contact.split('|') : [])];
  const cores = parts.filter((s) => typeof s === 'string' && (s.match(/\d/g) || []).length >= 8 && !/@/.test(s)).map(phoneCore);
  return [...new Set(cores.filter((c) => c.length >= 8 && !/^0+$/.test(c) && c !== phoneCore('0400 000 000')))];
}

function check(files, read) {
  const n = needles().map((s) => [s, wholeWord(s)]);
  const phones = phoneCores();
  const found = [];
  for (const f of files) {
    const rel = f.replace(/\\/g, '/');
    if (BLOCKED_PATHS.some((re) => re.test(rel))) { found.push(`${rel}: personal folder, must not be shared`); continue; }
    if (BLOCKED_FILES.some((re) => re.test(rel))) { found.push(`${rel}: generated document or match report, must not be shared`); continue; }
    let text;
    try { text = read(f); } catch { continue; }
    if (text.includes('\u0000')) { found.push(`${rel}: binary file, can't be checked for personal details, so it isn't shared`); continue; }
    for (const [s, re] of n) if (re.test(text)) found.push(`${rel}: contains "${s}"`);
    if (phones.length) {
      for (const m of text.match(/\+?\d[\d\s().-]{6,}\d/g) || []) {
        if (phones.includes(phoneCore(m))) { found.push(`${rel}: contains your phone number ("${m.trim()}")`); break; }
      }
    }
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
