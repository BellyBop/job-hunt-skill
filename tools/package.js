// Builds a shareable copy of the job hunt skill, with no personal data in it.
//
//   node tools/package.js
//
// Output: dist/job-hunt-skill/ and dist/job-hunt-skill.zip
// Included: the skill, the tools, the templates and the README.
// Left out: user/ (your resume, profile, sheet ID), applications-*/, archive/, node_modules/.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'job-hunt-skill');
const FILES = [
  'README.md',
  '.gitignore',
  '.claude/skills/job-hunt/SKILL.md',
  'tools/gen.js',
  'tools/tracker-setup.js',
  'tools/package.js',
  'tools/package.json',
  'tools/package-lock.json',
  'tools/README.md',
  'templates/resume.template.json',
  'templates/profile.template.json',
  'templates/cover-letter-example.template.md',
  'templates/tracker-defaults.json',
];

fs.rmSync(DIST, { recursive: true, force: true });
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.error(`Missing ${f}`); process.exit(1); }
  const dst = path.join(OUT, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// Safety net: refuse to package anything that looks like it came from user/.
const leaks = [];
const profile = path.join(ROOT, 'user', 'profile.json');
if (fs.existsSync(profile)) {
  const p = JSON.parse(fs.readFileSync(profile, 'utf8'));
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'user', 'resume.json'), 'utf8'));
  const needles = [p.spreadsheetId, p.filePrefix, r.email, r.phone, r.name].filter((s) => s && s.length > 4);
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(OUT, f), 'utf8');
    for (const n of needles) if (text.includes(n)) leaks.push(`${f} contains "${n}"`);
  }
}
if (leaks.length) {
  fs.rmSync(DIST, { recursive: true, force: true });
  console.error('NOT PACKAGED. Personal details found:\n  ' + leaks.join('\n  '));
  process.exit(1);
}

const zip = path.join(DIST, 'job-hunt-skill.zip');
const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
if (process.platform === 'win32' && fs.existsSync(winTar)) {
  execFileSync(winTar, ['-a', '-c', '-f', 'job-hunt-skill.zip', 'job-hunt-skill'], { cwd: DIST });
} else if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}' -DestinationPath '${zip}' -Force`]);
} else {
  execFileSync('zip', ['-r', '-q', 'job-hunt-skill.zip', 'job-hunt-skill'], { cwd: DIST });
}
console.log(`Packaged ${FILES.length} files, no personal details found.\n  ${zip}`);
