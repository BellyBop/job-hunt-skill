# Job Hunt skill for Claude

You tell it what you're after: any field, any level, from graduate nurse to senior developer. Claude finds those roles across many job sites, screens them against your own rules, writes a tailored resume and cover letter for each, fills in the application, and tracks every role and reply in a Google Sheet. **You stay in charge**: nothing is submitted until you say **accept**, and no email is sent until you say **send**.

Built for Australian job sites (SEEK, LinkedIn, Indeed, Jora, GradConnection, Prosple, government sites). It works elsewhere if you swap the sources during setup.

## What you need
- **Claude desktop app** (Code tab) or Claude Code, on a paid Claude plan. Works on Windows and Mac.
- **Node.js LTS**: https://nodejs.org (check with `node -v`).
- **Connectors** in Claude: Google Drive and Google Sheets (required), Gmail (for replies, job alerts and contact emails), Claude in Chrome (to search signed-in sites and apply), Indeed (optional).
- **Chrome**, signed in to SEEK, LinkedIn and Indeed.

## Set it up (about 15 minutes)
1. Get a copy somewhere permanent, e.g. `Documents/job-hunt`:
   - **With git** (recommended, so you can update later): `git clone https://github.com/BellyBop/job-hunt-skill.git`
   - **Without git**: on the GitHub page, click **Code → Download ZIP** and unzip it.
2. Open that folder in the Claude desktop app's Code tab (or run `claude` in it).
3. Say **set up job hunt**. Claude will:
   - install the document library (`npm install` in `tools`),
   - check your connectors and tell you what's missing,
   - read your current resume and turn it into `user/resume.json` (it never adds anything that isn't in your resume),
   - ask what roles you want (in your own words, any field), your level (graduate, junior, mid, senior or any), where, and your dealbreakers,
   - switch the screening rules and job boards on or off to suit your level (e.g. graduate boards for early career, a "too junior" filter for experienced people),
   - create your **Job Hunt Tracker** Google Sheet with search terms, local employers and screening rules filled in for you,
   - build a clean base resume for you to upload to the job sites.

## Use it
| Say | What happens |
|---|---|
| **job hunt** | Checks for replies, then searches every source (several at once), drops repeats, dealbreakers and pay below your minimum, drafts a resume and cover letter optimised for each good match, and lists them by ID with a keyword match score. |
| **apply to 12, 15** | Rebuilds those docs with today's date, fills in each application, and stops before submit to show you everything, including what was changed in your resume for this ad and why. You say change, reject or accept. |
| **any replies?** | Reads Gmail for employer replies and updates each role's stage (acknowledged, action needed, interview, rejected…). Flags anything with no reply after 10 days. |
| **email contacts for 12** | Finds the hiring manager, recruiters or HR people and the company's jobs inbox, and drafts a short note to them with your docs attached. Only uses published email addresses. Sent only when you say send. |
| **prep me for 12** | Interview prep: researches the company, matches your experience to what they want as STAR stories, lists likely questions with answer outlines, and offers a mock interview. |
| **set up job hunt** | Runs setup again, e.g. to change what you're looking for. |

## Resumes optimised for each ad
Applicant tracking systems rank resumes by how closely they match the ad. For every role, Claude picks the ad's key words, works the ones you genuinely have into your summary, skills and experience (in the ad's wording), and writes a `MATCH_` report next to the docs:
- the keyword score and what's still missing,
- every change made and the part of your resume that backs it,
- experience lines before and after rewording,
- any names or tools in the tailored resume that aren't in your base resume, so you can check they're true.

Missing keywords you don't have stay missing: they're real gaps, and Claude lowers the fit rating rather than pretending.

## Your tracker (Google Sheet)
- **Jobs**: every role ever seen, with a permanent ID, pay, status, stage, follow-up date and notes.
- **Follow-ups**: updates itself: action needed, interviews, follow-ups due, shortlists going stale.
- **Stats**: updates itself: reply rate, interview rate, roles found and applied per week (with a chart), and which role groups and job sites actually get replies.
- **Auto-drop**: your screening rules. Turn them on or off, switch between Drop and Flag, add keywords.
- **Sources**, **Search terms**, **Target companies**: where and what to search. Turn rows on or off.
- **Config**: locations, daily target, follow-up days, per-run limits, and **min_salary** (the lowest yearly pay you'll consider; roles below it are flagged or dropped, your choice).

Don't sort the Jobs tab in place, delete its rows, or type in Follow-up due, Follow-ups or Stats. Use the filter buttons instead.

## Your files
| File | What it is |
|---|---|
| `user/resume.json` | Your base resume, the only copy. Edit it, then say "rebuild my base resume". |
| `user/profile.json` | The roles you want (in groups), your level, screening flags, cover letter wording, your sheet's ID. Edit it to change what you're looking for, or say "set up job hunt" again. |
| `user/cover-letter-example.md` | A letter whose tone the generated letters copy. |
| `applications-YYYY-MM-DD/` | Each day's tailored resumes, cover letters and `MATCH_` reports. |
| `interviews/` | Your interview prep notes. |

Everything in `user/`, `applications-*` and `interviews/` is personal. It never leaves your computer except as the applications and emails you approve.

## Update to the latest version
If you cloned with git, run `git pull` in the folder (or ask Claude to "update the job hunt skill"). Your `user/` folder and applications are never touched by updates. If you downloaded the ZIP, download it again and copy your `user/` folder across.

Updates never break an existing setup: at the start of every run, Claude adds any new settings to your `profile.json` (with sensible defaults) and adds any new tabs or settings to your tracker sheet, then tells you what changed.

## Share it with a friend
Send them the link to this GitHub page. If they can't use GitHub, run `node tools/package.js`: it builds `dist/job-hunt-skill.zip` with the skill, tools, templates and this README, and refuses to build if any file contains your name, email, phone, address or sheet ID.

If you change the skill and commit, a git hook runs the same leak check first and blocks the commit if it finds anything personal. Setup turns it on; to turn it on yourself, run `git config core.hooksPath .githooks`.

## Rules Claude always follows
- Never submits an application without your **accept**, and never sends an email without your **send**.
- Never types passwords, solves CAPTCHAs, or works around a site that blocks it.
- Only emails addresses that are published (by the company, in the ad, or by the person themselves). It never guesses addresses from name patterns or uses email lookup tools.
- Caps LinkedIn Easy Apply at 5 per run (LinkedIn's terms don't allow automation).
- Never invents experience. Every resume change must be backed by something in your resume, and the match report shows you the evidence.
