# Job hunt tools

Reference for the scripts and the tracker. The skill itself is `.claude/skills/job-hunt/SKILL.md`; setup and everyday use are in the main `README.md`.

## Folder layout

```
<project>/
├─ README.md                      setup and everyday use
├─ .claude/skills/job-hunt/SKILL.md   the instructions Claude follows
├─ .githooks/pre-commit           runs the leak check before every commit
├─ tools/
│  ├─ gen.js                      builds resumes, cover letters and match reports
│  ├─ tracker-setup.js            builds a new tracker sheet, or upgrades an old one
│  ├─ profile.js                  adds new settings to older profiles
│  ├─ leak-check.js               blocks personal details from being shared
│  ├─ package.js                  makes a shareable zip
│  └─ README.md                   this file
├─ templates/                     blank starting files for a new user
│  ├─ resume.template.json
│  ├─ profile.template.json
│  ├─ cover-letter-example.template.md
│  └─ tracker-defaults.json       default Auto-drop rules, Sources, Config
├─ user/                          personal, never shared
│  ├─ resume.json                 base resume, the only copy
│  ├─ profile.json                targets, flags, wording, sheet ID
│  └─ cover-letter-example.md
├─ applications-YYYY-MM-DD/       each day's tailored docs and MATCH_ reports
└─ interviews/                    interview prep notes (personal)
```

All commands use forward slashes and run from the project folder, so they work on Windows, Mac and Linux.

## The tracker (Google Sheet)

Created during setup and linked by `spreadsheetId` in `user/profile.json`. Claude reads and writes it through the Google Sheets connector; there's no local copy.

Tabs:
- **Jobs**: one row per role. The ID is permanent and is the number you use in "apply to 52". Status: Shortlisted / Applied / Skipped / Dropped / Expired. Stage (after applying): Awaiting reply, Acknowledged, Action needed, Assessment, Phone screen, Interview, Final interview, Offer, Rejected, Withdrawn, No reply (closed). Rows are coloured by stage and status. **Follow-up due** (column R) is a formula: Applied + follow_up_after_days.
- **Follow-ups**: calculated live from Jobs: a summary line, then Action needed, In progress, Follow-up due (with days waiting) and Shortlist past expiry.
- **Read me**: a guide to every tab, status, stage and row colour. Column headings on Jobs and the settings tabs also have hover notes.
- **Stats**: calculated live from Jobs (plus eight charts, fed by the "Chart data" block from row 64): overview (roles seen, applied, replied, reply rate, progressed, interview rate, offers, rejected), roles found and applied for each of the last 8 weeks with a column chart, and applied / replied / progressed / reply rate by role group (Type) and by platform (Applied via). "Replied" means a real reply (action needed, assessment, interview, offer or rejection), not an automatic acknowledgement.
- **Form answers**: your standard answers for application forms and account sign-ups (Field, Answer, Notes, Group): name, contact details, street address, right to work, notice period, salary expectation, licences and checks, referees, voluntary diversity questions. Claude fills forms from it and only asks about fields that are blank or say "Ask me". Edit or add rows any time. Never put passwords here.
- **Auto-drop**: screening rules. Set Enabled to N to switch one off, change Action between Drop and Flag, or add rows. Keywords are comma separated; any one matching triggers the rule. "Match in" is Title, Ad text, Company or Any.
- **Sources**: where to search and apply. Enabled Y/N.
- **Search terms**: keywords searched on each site, each tagged with a group from the profile. Enabled Y/N.
- **Target companies**: employers whose careers pages are checked directly.
- **Config**: locations, daily target, search window, expiry and follow-up days, per-run limits, last reply check, next_id (a formula), min_salary and min_salary_action (Flag or Drop), tracker_version, and account_passwords ("Chrome suggests" or "I type it": how passwords are set when a site needs a new account; Claude never types or sees them).

Rules that keep the formulas working:
- New rows are written to the next empty row (never appended or inserted). The formulas use whole-column references, so they survive anyway, but appended rows pick up the header's styling.
- Don't sort the Jobs tab in place, delete rows, or type in column R or the Follow-ups tab. Use the filter buttons to view it in other orders.

### tracker-setup.js

```
node tools/tracker-setup.js <outFile> --part 1|2|3                       new tracker, sent as three calls in order
node tools/tracker-setup.js --upgrade <fromVersion> <outFile> --config-row <firstEmptyConfigRow> [--meta <sheets.json>]   upgrade an older one
```

**Upgrades.** The tracker's version is the `tracker_version` row in Config (missing means version 1). `--upgrade` writes only what that version is missing:
- 1 → 2: the Stats tab, and the min_salary, min_salary_action and tracker_version rows (written at `--config-row`, the first empty row of Config, so rows the user added aren't overwritten).
- 2 → 3: the easier-to-read layout. On Jobs: four saved filter views (Active, To decide, Applications, Everything, newest first), no text spilling into the next cell, 24px rows, short dates ("24 Nov 26"), ID, Company and Role frozen, light row lines, and Contact, Contact email and Last update folded into collapsed column groups. On the settings tabs: long text wraps.
- 3 → 4: a **Read me** tab first (every tab, status, stage and row colour explained), hover notes on every column heading of Jobs and the settings tabs, and seven more Stats charts (pipeline, status, where applications stand, fit, reply rate by role group, applications and replies by platform, applications over time). Their data lives in a "Chart data" block at `Stats!A64:N76`. It also rewrites the group and platform table formulas so they only look at rows 5 to 62.
- 4 → 5: the **Form answers** tab (fields only; the skill fills the answers from the resume and profile) and the account_passwords Config row with its dropdown (written at `--config-row`).

`--meta` is a saved `get_spreadsheet` result (fields `sheets.properties`); it maps tab titles to their sheetIds, which differ on trackers that weren't made by setup. Without it the setup IDs are used (Jobs 0, Config 105 and so on). After an upgrade from version 2 or later, the skill sets the existing tracker_version cell to the new version. The skill runs this automatically at the start of a run. To add a feature in a future version, bump `TRACKER_VERSION`, add its default rows to `tracker-defaults.json`, and add a `from < N` block to the upgrade section.

**New trackers.** Writes `{"requests": [...]}` for a brand-new blank spreadsheet, split into three parts sent as three `update_spreadsheet` calls in order (`--part 1`: tabs, formulas, dropdowns, colours and settings; `--part 2`: Stats and layout; `--part 3`: extra charts, Read me, Form answers and notes; with no `--part`, all three in one large batch). The spreadsheet is made (made with Drive `create_file`, mime type `application/vnd.google-apps.spreadsheet`, first tab sheetId 0). It builds every tab, header, formula, dropdown, colour and column width, using `templates/tracker-defaults.json` for the starting rules and `user/profile.json` for locale, timezone, the Type dropdown (the profile's group labels) and `level`. The `_levels` map in tracker-defaults.json lists the rules and sources that only start switched on for certain levels: "Senior title", the experience gates, "Students only" and the graduate boards for graduate and junior; "Too junior" for mid and senior; none of them for "any". Search terms, target companies and locations are filled in afterwards from the user's answers.

## Doc generator (gen.js)

Builds the tailored resume (.docx), cover letter (.docx) and plain-text cover letter for each role, from `user/resume.json`, `user/profile.json` and a jobs.json.

```
node gen.js --check <jobs.json>                    validate only
node gen.js <jobs.json> <outDir>                   build all
node gen.js <jobs.json> <outDir> --only WSP,METSO  build some (use on the day you submit)
node gen.js --base [outDir]                        build the untailored base resume (default: user/)
```

- File names start with the profile's `filePrefix`, e.g. `SURNAME_FIRSTNAME_-_RESUME_-_ACME.docx`.
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
- `keywords` (optional, recommended): the ad's 8 to 20 most important words and phrases, in the ad's wording
- `changes` (optional, recommended): `[{what, why, evidence}]`, one per change made for this ad; `evidence` names the resume.json entry that backs it. Changes without evidence fail validation
- `experience` (optional): `[{index, text}]` rewording experience entries for this ad (index into resume.json `experience`). Only allowed when `resumeOptimisation.rewriteExperience` is true in the profile

### Match report

For each role, `MATCH_-_<FILECOMPANY>.md` is written next to the docs, and a one-line summary is printed:
- **Keyword match**: how many of `keywords` appear in the tailored resume, which are missing, and whether that's below the profile's `resumeOptimisation.keywordTarget` (default 80%).
- **Changes made**: the `changes` table with evidence.
- **Experience lines reworded**: each original and reworded line.
- **Check these are true**: names, tools, qualifications and acronyms (capitalised words or words with digits, e.g. Azure, ITIL, 365) in the tailored summary, skills or experience that appear nowhere in resume.json. Each must be backed by the resume or removed.

## Profile upgrades (profile.js)

```
node tools/profile.js check      list settings an older profile is missing
node tools/profile.js upgrade    add them with their defaults, and save
```

The profile's version is `profileVersion`. `upgrade` runs any conversion steps for versions above it, copies in every setting from `templates/profile.template.json` that the profile doesn't have (never placeholders like name, file prefix, sheet ID, targets or screening), and sets the current version. gen.js loads profiles the same way in memory, so an old profile never breaks a build. The skill runs `upgrade` at the start of every run.

To add a setting: add it with a sensible default to the template, bump `PROFILE_VERSION` in profile.js and `profileVersion` in the template, and add a `MIGRATIONS` step only if an old value needs converting.

## Leak check (leak-check.js and the git hook)

```
node tools/leak-check.js --staged    check files staged for commit
node tools/leak-check.js <folder>    check every file in a folder
```

Looks for the name, email, address, LinkedIn URL, file prefix and sheet ID from `user/profile.json` and `user/resume.json` (whole words only, so a name never matches inside an ordinary word), and the phone number in any format (compared by digits, so spaces and +61 don't matter). It blocks any file inside `user/`, `applications-*/`, `archive/` or `interviews/`, any generated document (.docx, .pdf and similar) or `MATCH_` report wherever it is, and any other binary file, since those can't be checked. `.gitignore` also ignores .docx, .pdf and `MATCH_` files everywhere. `.githooks/pre-commit` runs it before every commit once `git config core.hooksPath .githooks` is set (setup does this). package.js runs it on the zip contents.

## Sharing (package.js)

```
node tools/package.js
```

Copies the skill, tools, templates and READMEs into `dist/job-hunt-skill/` and zips them to `dist/job-hunt-skill.zip`. It leaves out `user/`, `applications-*`, `archive/`, `interviews/` and `node_modules/`, and runs the leak check on the copied files, refusing to build the zip if it finds anything personal. On Windows it uses the built-in `tar.exe` (forward-slash paths, so the zip opens properly on a Mac); elsewhere it uses `zip`.
