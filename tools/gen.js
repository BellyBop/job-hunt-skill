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
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const R = readUser('resume.json');
const P = readUser('profile.json');
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

// ---------- documents ----------
function resume(job) {
  const kids = [
    p(R.name, { size: 36, bold: true, after: 40, align: AlignmentType.CENTER }),
    p(R.contact, { size: 20, align: AlignmentType.CENTER, after: 160 }),
    heading('Professional Summary'),
    p(job.summary),
    heading('Employment Experience'),
  ];
  for (const e of R.experience) {
    kids.push(p([run(e.title, true), run('  |  ' + e.dates)], { after: 40 }));
    kids.push(p(e.text));
  }
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
    const outDir = args[1] || '.';
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

  let jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  if (!Array.isArray(jobs)) fail(['jobs.json must be an array']);
  if (only) {
    const missing = [...only].filter((c) => !jobs.some((j) => j.fileCompany === c));
    if (missing.length) fail([`--only names not in ${jobsFile}: ${missing.join(', ')}`]);
    jobs = jobs.filter((j) => only.has(j.fileCompany));
  }

  const errs = jobs.flatMap(validate);
  const seen = new Set();
  for (const j of jobs) { if (seen.has(j.fileCompany)) errs.push(`duplicate fileCompany ${j.fileCompany}`); seen.add(j.fileCompany); }
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
    console.log(`built ${c} (letter dated ${date})`);
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
