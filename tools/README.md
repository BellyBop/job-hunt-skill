# Job hunt tools

Reference for the scripts and the tracker. The skill itself is `.claude\skills\job-hunt\SKILL.md`; setup and everyday use are in the main `README.md`.

## Folder layout

```
<project>\
├─ README.md                      setup and everyday use
├─ .claude\skills\job-hunt\SKILL.md   the instructions Claude follows
├─ tools\
│  ├─ gen.js                      builds resumes and cover letters
│  ├─ tracker-setup.js            builds a new Job Hunt Tracker sheet
│  ├─ package.js                  makes a shareable zip
│  └─ README.md                   this file
├─ templates\                     blank starting files for a new user
│  ├─ resume.template.json
│  ├─ profile.template.json
│  ├─ cover-letter-example.template.md
│  └─ tracker-defaults.json       default Auto-drop rules, Sources, Config
├─ user\                          personal, never shared
│  ├─ resume.json                 base resume, the only copy
│  ├─ profile.json                targets, flags, wording, sheet ID
│  └─ cover-letter-example.md
└─ applications-YYYY-MM-DD\       each day's tailored docs
```

## The tracker (Google Sheet)

Created during setup and linked by `spreadsheetId` in `user\profile.json`. Claude reads and writes it through the Google Sheets connector; there's no local copy.

Tabs:
- **Jobs**: one row per role. The ID is permanent and is the number you use in "apply to 52". Status: Shortlisted / Applied / Skipped / Dropped / Expired. Stage (after applying): Awaiting reply, Acknowledged, Action needed, Assessment, Phone screen, Interview, Final interview, Offer, Rejected, Withdrawn, No reply (closed). Rows are coloured by stage and status. **Follow-up due** (column R) is a formula: Applied + follow_up_after_days.
- **Follow-ups**: calculated live from Jobs: a summary line, then Action needed, In progress, Follow-up due (with days waiting) and Shortlist past expiry.
- **Auto-drop**: screening rules. Set Enabled to N to switch one off, change Action between Drop and Flag, or add rows. Keywords are comma separated; any one matching triggers the rule. "Match in" is Title, Ad text, Company or Any.
- **Sources**: where to search and apply. Enabled Y/N.
- **Search terms**: keywords searched on each site, each tagged with a group from the profile. Enabled Y/N.
- **Target companies**: employers whose careers pages are checked directly.
- **Config**: locations, daily target, search window, expiry and follow-up days, per-run limits, last reply check, and next_id (a formula).

Rules that keep the formulas working:
- New rows are written to the next empty row (never appended or inserted). The formulas use whole-column references, so they survive anyway, but appended rows pick up the header's styling.
- Don't sort the Jobs tab in place, delete rows, or type in column R or the Follow-ups tab. Use the filter buttons to view it in other orders.

### tracker-setup.js

```
node tracker-setup.js <outFile>
```

Writes `{"requests": [...]}` for one `update_spreadsheet` call on a brand-new blank spreadsheet (made with Drive `create_file`, mime type `application/vnd.google-apps.spreadsheet`, first tab sheetId 0). It builds every tab, header, formula, dropdown, colour and column width, using `templates\tracker-defaults.json` for the starting rules and `user\profile.json` for locale, timezone, the Type dropdown (the profile's group labels) and `level`. The `_levels` map in tracker-defaults.json lists the rules and sources that only start switched on for certain levels: "Senior title", the experience gates, "Students only" and the graduate boards for graduate and junior; "Too junior" for mid and senior; none of them for "any". Search terms, target companies and locations are filled in afterwards from the user's answers.

## Doc generator (gen.js)

Builds the tailored resume (.docx), cover letter (.docx) and plain-text cover letter for each role, from `user\resume.json`, `user\profile.json` and a jobs.json.

```
node gen.js --check <jobs.json>                    validate only
node gen.js <jobs.json> <outDir>                   build all
node gen.js <jobs.json> <outDir> --only WSP,METSO  build some (use on the day you submit)
node gen.js --base <outDir>                        build the untailored base resume
```

- File names start with the profile's `filePrefix`, e.g. `SMITH_ALEX_-_RESUME_-_ACME.docx`.
- The cover letter is dated **today in the profile's timezone**. Rebuild on the day of submission. A job can set `"date"` to override it.
- The salutation, intro line, closing line and sign-off come from `coverLetter` in the profile.
- Resume sections Strengths, Additional Elements and References are left out when empty in resume.json.
- Every run validates first and builds nothing if anything fails: em or en dashes, placeholder text, empty fields, 2-3 bullets, 4-12 skills, summary under 90 words, letter body under 400 words, UPPER_SNAKE `fileCompany`, `ref` as "Source - Role - Company".

`jobs.json` is an array. Each entry has:
- `fileCompany`: UPPER_SNAKE company name used in file names
- `summary`: tailored Professional Summary
- `skills`: Key Skills lines, reordered and trimmed for the ad
- `ref`: "Source - Role - Company"
- `opening`, `bullets` ([label, text] pairs, 2-3 of them), `drew`
- `availability` (optional): replaces the default availability line from resume.json
- `salutation` (optional): replaces the profile's salutation
- `date` (optional): overrides today's date on the letter

## Sharing (package.js)

```
node tools\package.js
```

Copies the skill, tools, templates and READMEs into `dist\job-hunt-skill\` and zips them to `dist\job-hunt-skill.zip`. It leaves out `user\`, `applications-*`, `archive\` and `node_modules\`, and refuses to build the zip if any copied file contains your name, email, phone, file prefix or sheet ID.
