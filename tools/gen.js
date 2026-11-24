// Builds tailored resumes and cover letters from user/resume.json + user/profile.json + a jobs.json.
//
//   node gen.js <jobs.json> <outDir>                 build every job in the file
//   node gen.js <jobs.json> <outDir> --only A,B      build only these fileCompany values
//   node gen.js --base <outDir>                      build the untailored base resume
//   node gen.js --check <jobs.json>                  validate only, write nothing
//
// The cover letter date is today in the profile's timezone, unless the job sets "date".
// Run it again on the day you submit so the letter carries the submission date.
const fs = require('fs');
const path = require('path');
let docx;
try { docx = require('docx'); } catch {
  console.error('The docx library is not installed. Run: npm install   (inside the tools folder)');
  process.exit(2);
}
const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = docx;

const USER_DIR = path.join(__dirname, '..', 'user');
const readUser = (f) => {
  const p = path.join(USER_DIR, f);
  if (!fs.existsSync(p)) { console.error(`Missing ${p}. Run setup first (say "set up job hunt").`); process.exit(2); }
  return require('./profile').readJsonFile(p);
};
const R = readUser('resume.json');
readUser('profile.json'); // exits with a setup hint if missing
const P = require('./profile').load(); // fills in any settings an older profile is missing
const CL = P.coverLetter || {};
const PREFIX = P.filePrefix || R.name.toUpperCase().split(/\s+/).reverse().join('_').replace(/[^A-Z0-9_]/g, '');
const FONT = 'Calibri';

// ---------- helpers ----------
const letterDate = () => new Intl.DateTimeFormat(P.locale ? P.locale.replace('_', '-') : 'en-AU', {
  timeZone: P.timezone || 'Australia/Sydney', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date());

const p = (text, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 120 },
  alignment: opts.align,
  children: Array.isArray(text) ? text : [new TextRun({ text, font: FONT, size: opts.size ?? 22, bold: opts.bold })],
});
const run = (text, bold) => new TextRun({ text, font: FONT, size: 22, bold });
const heading = (text) => new Paragraph({
  spacing: { before: 200, after: 100 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '444444', space: 2 } },
  children: [new TextRun({ text: text.toUpperCase(), font: FONT, size: 24, bold: true })],
});
const bullet = (children) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children });

// ---------- validation ----------
const BANNED = [
  [/[—–]/, 'em or en dash (use a hyphen, comma or new sentence)'],
  [/\b(TODO|TBD|XXX|lorem)\b/i, 'placeholder text'],
  [/\[[^\]]*(company|role|name)[^\]]*\]|<[^>]*(company|role|name)[^>]*>/i, 'unfilled [Company]/<Role> style placeholder'],
];
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

function checkText(where, s, errs) {
  if (typeof s !== 'string' || !s.trim()) { errs.push(`${where}: missing or empty`); return; }
  for (const [re, why] of BANNED) if (re.test(s)) errs.push(`${where}: ${why}: "${s.match(re)[0]}"`);
}

function validate(job, i) {
  const errs = [];
  const id = `job[${i}] ${job.fileCompany || '(no fileCompany)'}`;
  if (!/^[A-Z0-9_]+$/.test(job.fileCompany || '')) errs.push(`${id}: fileCompany must be UPPER_SNAKE (A-Z, 0-9, _)`);
  checkText(`${id}.summary`, job.summary, errs);
  if (job.summary && words(job.summary) > 90) errs.push(`${id}.summary: ${words(job.summary)} words, keep it under 90`);
  if (!Array.isArray(job.skills) || job.skills.length < 4 || job.skills.length > 12) errs.push(`${id}.skills: needs 4-12 lines`);
  else job.skills.forEach((s, k) => checkText(`${id}.skills[${k}]`, s, errs));
  checkText(`${id}.ref`, job.ref, errs);
  if (job.ref && job.ref.split(' - ').length < 3) errs.push(`${id}.ref: should be "Source - Role - Company"`);
  checkText(`${id}.opening`, job.opening, errs);
  checkText(`${id}.drew`, job.drew, errs);
  if (!Array.isArray(job.bullets) || job.bullets.length < 2 || job.bullets.length > 3) errs.push(`${id}.bullets: needs 2-3 [label, text] pairs`);
  else job.bullets.forEach((b, k) => {
    if (!Array.isArray(b) || b.length !== 2) errs.push(`${id}.bullets[${k}]: must be [label, text]`);
    else { checkText(`${id}.bullets[${k}].label`, b[0], errs); checkText(`${id}.bullets[${k}].text`, b[1], errs); }
  });
  for (const k of ['availability', 'salutation', 'date']) if (job[k] !== undefined) checkText(`${id}.${k}`, job[k], errs);
  // Optional ATS fields: keywords from the ad, the changes made for this ad, and reworded experience lines.
  if (job.keywords !== undefined && (!Array.isArray(job.keywords) || job.keywords.some((k) => typeof k !== 'string' || !k.trim()))) errs.push(`${id}.keywords: must be a list of words or phrases from the ad`);
  if (job.changes !== undefined) {
    if (!Array.isArray(job.changes)) errs.push(`${id}.changes: must be a list of {what, why, evidence}`);
    else job.changes.forEach((c, k) => {
      for (const f of ['what', 'why', 'evidence']) if (!c || typeof c[f] !== 'string' || !c[f].trim()) errs.push(`${id}.changes[${k}].${f}: missing. Every change needs evidence from resume.json, or it must not be made`);
    });
  }
  if (job.experience !== undefined) {
    if (!RO.rewriteExperience) errs.push(`${id}.experience: rewording experience is switched off in profile.json (resumeOptimisation.rewriteExperience)`);
    if (!Array.isArray(job.experience)) errs.push(`${id}.experience: must be a list of {index, text}`);
    else job.experience.forEach((e, k) => {
      if (!e || !Number.isInteger(e.index) || !R.experience[e.index]) errs.push(`${id}.experience[${k}].index: no experience entry ${e && e.index} in resume.json`);
      checkText(`${id}.experience[${k}].text`, e && e.text, errs);
    });
  }
  const letterWords = words([job.opening, ...(job.bullets || []).flat(), job.drew].join(' '));
  if (letterWords > 400) errs.push(`${id}: cover letter body is ${letterWords} words, keep it under 400`);
  return errs;
}

function validateResumeJson() {
  const errs = [];
  const all = JSON.stringify(R);
  for (const [re, why] of BANNED.slice(0, 1)) if (re.test(all)) errs.push(`resume.json: ${why}`);
  return errs;
}

// ---------- ATS match ----------
const RO = P.resumeOptimisation || {};
const experienceText = (job, i) => {
  const o = (job.experience || []).find((e) => e.index === i);
  return o ? o.text : R.experience[i].text;
};
const norm = (s) => ' ' + String(s).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
const STOP = new Set('a an and are as at be by for from has have in into is it its of on or our that the their this to was were will with within your you i my me we us also across using used use work worked working role team teams able strong skills skill experience including ensure ensuring'.split(' '));

function tailoredText(job) {
  return [job.summary, ...job.skills, ...R.experience.map((e, i) => `${e.title} ${experienceText(job, i)}`),
    ...R.education.map((e) => `${e.title} ${e.detail}`), ...(R.strengths || []).flat(), R.additional || ''].join(' ');
}

// Every fact the user has given: resume.json in full plus profile experience.
const BASE = norm(JSON.stringify(R) + ' ' + (P.experience || ''));

function matchReport(job) {
  const text = norm(tailoredText(job));
  const kws = (job.keywords || []).map((k) => k.trim());
  const hit = kws.filter((k) => text.includes(norm(k)));
  const missing = kws.filter((k) => !hit.includes(k));
  const share = kws.length ? hit.length / kws.length : null;
  const inBase = (w) => { const n = norm(w).trim(); return !n || BASE.includes(` ${n} `) || BASE.includes(` ${n}s `) || BASE.includes(` ${n.replace(/s$/, '')} `); };
  // Single-word ad keywords (e.g. "ITIL", "Kubernetes"); multi-word phrases are matched by the keyword table instead.
  const kwWords = new Set(kws.map((k) => norm(k).trim()).filter((k) => k && !k.includes(' ')));
  // Words from the target role and company (job.ref, e.g. "SEEK - Junior DevOps Engineer - Cogito") describe the job, not a claim.
  const refWords = new Set(norm(job.ref || '').trim().split(' '));
  // Strong list: names, tools, qualifications, acronyms and numbers that appear nowhere in resume.json
  // (e.g. "Azure", "ITIL", "365", "Kubernetes"), including at the start of a sentence, plus any ad keyword
  // that was added without being in the base resume. Each must be confirmed true or removed.
  // Skills lines are lists of claims, so any new word there counts as a claim, whatever its case.
  const tailoredParts = [[job.summary, false], ...job.skills.map((s) => [s, true]), ...(job.experience || []).map((e) => [e.text, false])];
  const strong = new Set();
  const soft = new Set();
  for (const [part, isSkill] of tailoredParts) {
    const sentences = String(part).split(/(?<=[.!?:;])\s+/);
    for (const s of sentences) {
      const tokens = s.match(/[A-Za-z0-9][A-Za-z0-9+#.$%,'-]*[A-Za-z0-9+#%]|[A-Za-z0-9]/g) || [];
      tokens.forEach((raw, idx) => {
        const t = raw.replace(/[.,]+$/, '');
        const lower = norm(t).trim();
        if (!lower || lower.length < 2 || STOP.has(lower) || inBase(t)) return;
        if (lower.split(' ').every((w) => refWords.has(w))) return;
        const hasDigit = /\d/.test(t);
        const allCaps = /^[A-Z0-9+#]{2,}$/.test(t);
        const midCaps = idx > 0 && /^[A-Z]/.test(t);
        const startCaps = idx === 0 && /^[A-Z]/.test(t) && !lower.split(" ").every((w) => COMMON.has(w));
        const isKeyword = kwWords.has(lower);
        const skillWord = isSkill && lower.length > 2 && !lower.split(" ").every((w) => COMMON.has(w));
        if (hasDigit || allCaps || midCaps || startCaps || isKeyword || skillWord) strong.add(t);
        else if (lower.length > 2) soft.add(lower);
      });
    }
  }
  // Reworded experience lines: numbers that changed, and words added or removed compared with the original.
  const numRe = /\$?\d[\d,.]*\s?(?:k|m|%|\+)?/gi;
  const normNum = (s) => s.toLowerCase().replace(/[\s,$]/g, '');
  const rewrites = (job.experience || []).map((e) => {
    const before = R.experience[e.index].text;
    const beforeNums = new Set((before.match(numRe) || []).map(normNum));
    const afterNums = (e.text.match(numRe) || []).map(normNum);
    const changedNums = [...new Set(afterNums.filter((n) => !beforeNums.has(n)))];
    const bw = new Set(norm(before).trim().split(' ').filter((w) => !STOP.has(w)));
    const aw = new Set(norm(e.text).trim().split(' ').filter((w) => !STOP.has(w)));
    return { index: e.index, changedNums, added: [...aw].filter((w) => !bw.has(w)), removed: [...bw].filter((w) => !aw.has(w)) };
  });
  for (const r of rewrites) for (const n of r.changedNums) strong.add(n);
  return { kws, hit, missing, share, unbacked: [...strong], soft: [...soft].filter((w) => ![...strong].some((s) => norm(s).trim() === w)), rewrites };
}

// Ordinary words that often start a resume sentence; not treated as claims when capitalised at a sentence start.
const COMMON = new Set(('graduate recent recently keen motivated passionate experienced detail dedicated reliable '
  + 'built build developed develop designed design delivered deliver managed manage led lead created create improved improve '
  + 'worked supported support provided provide completed complete produced produce engaged engage followed follow navigated '
  + 'comfortable confident proven hands seeking looking eager enthusiastic organised organized friendly professional '
  + 'currently skilled solid good great quick fast strong bachelor diploma certificate degree computer software web '
  + 'languages tools platforms databases operating system systems user algorithms quality testing networking security '
  + 'full stack end customer client team clear written verbal communication problem solving time technical '
  + 'writes write uses use holds hold works brings bring takes take learns learn enjoys enjoy thrives thrive '
  + 'self-starter self starter adaptable curious organised hardworking hard-working approachable collaborative').split(' '));

function reportMarkdown(job, m) {
  const target = RO.keywordTarget ?? 0.8;
  const L = [`# Resume match: ${job.ref}`, ''];
  if (m.share === null) L.push('No ad keywords were given, so the match wasn\'t checked.', '');
  else {
    L.push(`**Keyword match: ${m.hit.length}/${m.kws.length} (${Math.round(m.share * 100)}%)**${m.share < target ? `, below your ${Math.round(target * 100)}% target` : ''}`, '');
    L.push('| Keyword from the ad | In resume |', '|---|---|', ...m.kws.map((k) => `| ${k} | ${m.hit.includes(k) ? 'yes' : '**no**'} |`), '');
    if (m.missing.length) L.push(`Missing: ${m.missing.join(', ')}. Only add these if they're true for you; otherwise they're real gaps to mention honestly (or skip the role).`, '');
  }
  L.push('## Changes made for this ad', '');
  if (!(job.changes || []).length) L.push('None recorded.', '');
  else L.push('| Change | Why | Backed by (from your resume) |', '|---|---|---|', ...job.changes.map((c) => `| ${c.what} | ${c.why} | ${c.evidence} |`), '');
  if ((job.experience || []).length) {
    L.push('## Experience lines reworded', '');
    for (const e of job.experience) {
      const r = m.rewrites.find((x) => x.index === e.index) || { changedNums: [], added: [], removed: [] };
      L.push(`**${R.experience[e.index].title}**`, '', `- Before: ${R.experience[e.index].text}`, `- After: ${e.text}`);
      if (r.changedNums.length) L.push(`- **Numbers not in the original: ${r.changedNums.join(', ')}.** Numbers must never change; fix this before using the resume.`);
      if (r.added.length) L.push(`- Words added: ${r.added.join(', ')}`);
      if (r.removed.length) L.push(`- Words removed: ${r.removed.join(', ')}`);
      L.push('');
    }
  }
  L.push('## Check these are true', '');
  L.push(m.unbacked.length ? `These names, tools, numbers or ad keywords are in the tailored resume but not in your base resume: **${m.unbacked.join(', ')}**. Each one must honestly describe your experience, or be removed.` : 'No names, tools, numbers or ad keywords were added that aren\'t in your base resume.', '');
  if (m.soft.length) L.push(`Other new wording (usually fine, but skim it): ${m.soft.join(', ')}`, '');
  return L.join('\n');
}

// ---------- documents ----------
function resume(job) {
  const kids = [
    p(R.name, { size: 36, bold: true, after: 40, align: AlignmentType.CENTER }),
    p(R.contact, { size: 20, align: AlignmentType.CENTER, after: 160 }),
    heading('Professional Summary'),
    p(job.summary),
    heading('Employment Experience'),
  ];
  R.experience.forEach((e, i) => {
    kids.push(p([run(e.title, true), run('  |  ' + e.dates)], { after: 40 }));
    kids.push(p(experienceText(job, i)));
  });
  kids.push(heading('Education and Training'));
  R.education.forEach((e, k) => kids.push(p([run(e.title, true), run(', ' + e.detail)], { after: k < R.education.length - 1 ? 60 : 120 })));
  kids.push(heading('Key Skills'));
  for (const s of job.skills) kids.push(bullet([run(s)]));
  if (R.strengths && R.strengths.length) {
    kids.push(heading('Strengths'));
    for (const [label, text] of R.strengths) kids.push(bullet([run(label + ': ', true), run(text)]));
  }
  if (R.additional) { kids.push(heading('Additional Elements')); kids.push(p(R.additional)); }
  if (R.references) { kids.push(heading('References')); kids.push(p(R.references)); }
  return new Document({ sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: kids }] });
}

const CLOSE = CL.close || 'Thank you for considering my application and I look forward to hearing from you soon.';
const INTRO = CL.intro || 'Here is what caught my eye about your job posting and how I think my experience can benefit your team:';
const SALUTATION = CL.salutation || 'Dear Hiring Manager,';
const SIGNOFF = CL.signoff || 'Kind Regards,';

function cover(job, date) {
  const kids = [
    p(R.name, { size: 32, bold: true, after: 40 }),
    p(R.contact, { size: 20, after: 200 }),
    p(date),
    p([run('Re: ', true), run(job.ref)], { after: 200 }),
    p(job.salutation || SALUTATION),
    p(job.opening),
    p(INTRO),
  ];
  for (const [label, text] of job.bullets) kids.push(bullet([run(label + ': ', true), run(text)]));
  kids.push(p(job.availability || R.defaultAvailability, { after: 120 }));
  kids.push(p(job.drew));
  kids.push(p(CLOSE));
  kids.push(p(SIGNOFF, { after: 40 }));
  kids.push(p(R.name));
  return new Document({ sections: [{ properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } }, children: kids }] });
}

function plain(job) {
  return [
    job.salutation || SALUTATION, '', job.opening, '', INTRO,
    ...job.bullets.map(([l, t]) => `- ${l}: ${t}`), '',
    job.availability || R.defaultAvailability, '',
    job.drew, '', CLOSE, '', SIGNOFF, R.name, '',
  ].join('\r\n');
}

// ---------- main ----------
function fail(errs) {
  console.error('NOT BUILT. Fix these first:\n  ' + errs.join('\n  '));
  process.exit(1);
}

(async () => {
  const args = process.argv.slice(2);
  const resumeErrs = validateResumeJson();
  if (resumeErrs.length) fail(resumeErrs);

  if (args[0] === '--base') {
    const outDir = args[1] || path.join(__dirname, '..', 'user'); // default: user/ (git-ignored), never the project folder
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${PREFIX}_-_RESUME.docx`);
    fs.writeFileSync(file, await Packer.toBuffer(resume({ summary: R.summary, skills: R.skills })));
    console.log('built base resume', file);
    return;
  }

  const checkOnly = args[0] === '--check';
  const jobsFile = checkOnly ? args[1] : args[0];
  const outDir = checkOnly ? null : args[1];
  if (!jobsFile || (!checkOnly && !outDir)) {
    console.error('Usage: node gen.js <jobs.json> <outDir> [--only A,B] | --check <jobs.json> | --base <outDir>');
    process.exit(2);
  }
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx > -1 ? new Set(args[onlyIdx + 1].split(',').map((s) => s.trim())) : null;

  let jobs = require('./profile').readJsonFile(path.resolve(jobsFile));
  if (!Array.isArray(jobs)) fail(['jobs.json must be an array']);
  if (only) {
    const missing = [...only].filter((c) => !jobs.some((j) => j.fileCompany === c));
    if (missing.length) fail([`--only names not in ${jobsFile}: ${missing.join(', ')}`]);
    jobs = jobs.filter((j) => only.has(j.fileCompany));
  }

  const errs = jobs.flatMap(validate);
  const seen = new Set();
  for (const j of jobs) { if (seen.has(j.fileCompany)) errs.push(`duplicate fileCompany ${j.fileCompany}: two roles at the same company need different names, e.g. ${j.fileCompany}_FULL_STACK and ${j.fileCompany}_SOFTWARE_ENGINEER`); seen.add(j.fileCompany); }
  if (errs.length) fail(errs);
  if (checkOnly) { console.log(`OK: ${jobs.length} job(s) pass validation`); return; }

  fs.mkdirSync(outDir, { recursive: true });
  const today = letterDate();
  for (const job of jobs) {
    const c = job.fileCompany;
    const date = job.date || today;
    fs.writeFileSync(path.join(outDir, `${PREFIX}_-_RESUME_-_${c}.docx`), await Packer.toBuffer(resume(job)));
    fs.writeFileSync(path.join(outDir, `${PREFIX}_-_COVERLETTER_-_${c}.docx`), await Packer.toBuffer(cover(job, date)));
    fs.writeFileSync(path.join(outDir, `${PREFIX}_-_COVERLETTER_-_${c}.txt`), plain(job));
    const m = matchReport(job);
    fs.writeFileSync(path.join(outDir, `MATCH_-_${c}.md`), reportMarkdown(job, m));
    const kw = m.share === null ? 'no keywords given' : `keywords ${m.hit.length}/${m.kws.length} (${Math.round(m.share * 100)}%)${m.missing.length ? `, missing: ${m.missing.join(', ')}` : ''}`;
    const chk = m.unbacked.length ? `; check: ${m.unbacked.join(', ')}` : '';
    console.log(`built ${c} (letter dated ${date}; ${kw}${chk})`);
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
