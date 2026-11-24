// Keeps user/profile.json up to date when the skill adds new settings.
//
//   node tools/profile.js upgrade    add any missing settings (with their defaults) and save
//   node tools/profile.js check      list what's missing, change nothing
//
// The skill runs "upgrade" at the start of every run, and gen.js loads profiles through load(),
// so an older profile never breaks anything.
//
// To add a setting in a future version:
//   1. Add it with a sensible default to templates/profile.template.json.
//   2. Bump PROFILE_VERSION here (and "profileVersion" in the template).
//   3. If the old value needs converting (not just adding), add a step to MIGRATIONS.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'user', 'profile.json');
const TEMPLATE = path.join(ROOT, 'templates', 'profile.template.json');
const PROFILE_VERSION = 2;

// Placeholder values in the template that must never be copied into a real profile.
const NO_COPY = new Set(['name', 'filePrefix', 'spreadsheetId', 'baseResumeFileOnSites', 'targets', 'experience', 'screening']);

// Steps that convert old values. Each runs once, when upgrading past its version.
const MIGRATIONS = {
  2: (p) => {
    // v2 added level, experience and the contact email options. Profiles made before v2 were all early career.
    if (!p.level) p.level = 'junior';
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function fillMissing(target, defaults, prefix, added) {
  for (const [k, v] of Object.entries(defaults)) {
    if (k.startsWith('_')) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (!(k in target)) {
      if (!prefix && NO_COPY.has(k)) continue;
      target[k] = JSON.parse(JSON.stringify(v));
      added.push(key);
    } else if (isObj(v) && isObj(target[k]) && !(!prefix && NO_COPY.has(k))) {
      fillMissing(target[k], v, key, added);
    }
  }
}

function upgradeObject(profile) {
  const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  const p = JSON.parse(JSON.stringify(profile));
  const from = Number(p.profileVersion || 1);
  const ran = [];
  for (let v = from + 1; v <= PROFILE_VERSION; v++) if (MIGRATIONS[v]) { MIGRATIONS[v](p); ran.push(v); }
  const added = [];
  fillMissing(p, template, '', added);
  p.profileVersion = PROFILE_VERSION;
  return { profile: p, added, ran, from };
}

// Used by gen.js: the profile with defaults filled in, without writing anything.
function load() {
  if (!fs.existsSync(PROFILE)) return null;
  return upgradeObject(JSON.parse(fs.readFileSync(PROFILE, 'utf8'))).profile;
}

module.exports = { load, upgradeObject, PROFILE_VERSION };

if (require.main === module) {
  const cmd = process.argv[2] || 'check';
  if (!fs.existsSync(PROFILE)) { console.error('No user/profile.json yet. Run setup first (say "set up job hunt").'); process.exit(2); }
  const raw = JSON.parse(fs.readFileSync(PROFILE, 'utf8'));
  const { profile, added, ran, from } = upgradeObject(raw);
  const changed = added.length || ran.length || from !== PROFILE_VERSION;
  if (!changed) { console.log(`Profile is up to date (version ${PROFILE_VERSION}).`); process.exit(0); }
  const summary = `version ${from} -> ${PROFILE_VERSION}` + (added.length ? `; added: ${added.join(', ')}` : '') + (ran.length ? `; converted for: v${ran.join(', v')}` : '');
  if (cmd === 'upgrade') {
    fs.writeFileSync(PROFILE, JSON.stringify(profile, null, 2) + '\n');
    console.log(`Profile upgraded (${summary}).`);
  } else {
    console.log(`Profile needs upgrading (${summary}). Run: node tools/profile.js upgrade`);
  }
}
