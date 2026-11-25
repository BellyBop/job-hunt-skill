# Site playbooks (Mode 2)

How each application system behaves, so forms get filled without trial and error. Read the section for a site before opening it. When you learn something new about a site (a field that needs a different method, a step that changed), add it here in the same style, so the next run is faster. Keep entries short and never record personal details here.

## Fast form filling on any site
- **Map the page in one call.** Run one `javascript_tool` call that lists every visible field: label text, type, name or id, current value, and for selects or listboxes the option texts. Plan all answers from that, instead of one `find` per field. Re-map only after the page changes.
- **Fill in one batch.** Put every action for a page into one `browser_batch`: plain text inputs and native selects with `form_input`; custom widgets with click, type, key.
- **Read back in one call.** After filling, one `javascript_tool` call returns every field's value. Fix only what's wrong. Take at most one screenshot per page, at reduced scale (0.4 to 0.5).
- **Custom dropdowns** (role=combobox or listbox, aria-haspopup): open them, read the options with `[...document.querySelectorAll('[role=option]')].map(o=>o.innerText.trim())`, then either click the option's ref (from `find`) or press Down n times and Enter, where n is the option's position after the "Select" placeholder.
- **Radios and checkboxes** that are hidden behind styled labels: click the label, or `input.click()` in JS, then check `.checked`. Only click inputs whose question you've identified. Hidden conditional questions stay unanswered.
- **React-style text inputs** (Workday, some others) ignore `form_input`. Click the field, then `type`.
- **File uploads:** `file_upload` on the hidden `input[type=file]` (find it with `find "file input"` or `read_page` on the upload group). Never click "Select files" buttons: that opens a native picker you can't see. Confirm the upload registered: the file name or a "Delete file" button appears. If it didn't, upload again.
- **Honeypot fields** (labels like "This input is for robots only, do not enter if you're human"): never fill them.
- **Typing doubles up** if a field already had focus and text: check the read-back. `form_input` the exact value to fix it.
- **Tabs don't survive the conversation.** Chrome tab groups reset when a new conversation starts, so a half-filled form with no account is lost. Finish or abandon no-account forms in the same session, and note in the role's Notes how far it got.

## SEEK (Quick Apply)
- Apply link: `https://au.seek.com/job/<number>/apply`. It either opens Quick Apply or redirects to the employer's system (then use that site's playbook).
- Check the selected resume is today's tailored one after upload. A failed upload silently leaves the old one selected. Saved resumes are capped at 10.
- Employer questions are on one page. Answer from Form answers.
- Success page URL ends in `/apply/success` with "Application sent".

## LinkedIn
- "Apply on company website" links to the employer's system (often Workday). Use that playbook.
- Easy Apply counts toward `linkedin_easy_apply_max`.

## Lever (jobs.lever.co)
- No account. One page: resume upload, name, email, phone, links, questions, then Submit.
- An hCaptcha can appear after Submit. The user solves it. A receipt email follows.

## Teamtailor
- No account, but an email verification link is sent before the application is complete. The user clicks it (or says to open it for that site).

## Workday (*.myworkdayjobs.com)
- Apply → "Apply Manually" (or "Autofill with Resume"). Step 1 is Create Account: email, password, verify password, and a "Candidate Privacy Statement" checkbox. Skip the honeypot "website" field.
- Password: click into the password box. Chrome may fill a suggested password into both boxes by itself. Never read it: ask the user to confirm Chrome saved it (or to pick Use suggested password) and to click Create Account, or click it once they confirm.
- Accounts are per employer (each company's Workday is separate). The user may get a verification email.
- My Information fields have stable ids: `name--legalName--firstName`, `name--legalName--lastName`, `address--addressLine1`, `address--city`, `address--postalCode`, `phoneNumber--phoneNumber`; `address--countryRegion` and `phoneNumber--phoneType` are dropdown buttons. "Previously worked for us" is a radio pair. Text inputs need click then type.
- Dropdown buttons (`aria-haspopup=listbox`): click, `find` the option text, click its ref.
- My Experience: the resume file input accepts several files, so upload resume and cover letter together. Work experience is optional when a resume is attached. LinkedIn takes the full https URL.
- Application Questions often include written answers in the user's own words, an age band and an academic results band. Draft written answers only from resume.json and show them in full in the overview.
- Steps: My Information, My Experience, Application Questions, Voluntary Disclosures, (Self Identify), Review, then Submit on Review.

## PageUp (*.pageuppeople.com)
- Begin page: email box plus a required "By continuing, you agree..." checkbox (`checkagree`). Type the email once and check it didn't double up.
- Next page: "Save time on your application". Upload the resume to its file input, then "Continue with application". It pre-fills personal details from the resume.
- Dropdowns are custom comboboxes: click the "Open list" button next to each, then Down n and Enter. Title, State, Country and Employment status are on the first page. The home address is required.
- Pages differ by employer. ABC had: Personal details, Visa and citizenship, Diversity 1 and 2, Skills and experience (a free-text "why you suit this role"), Salary band radios, Working With Children (N/A unless the ad mentions children), Upload (resume, cover letter, supporting documents), Applicant declaration (no checkbox: submitting is the declaration), then Submit.
- The breadcrumb bar lists every page up front, which tells you how long the form is.

## Dayforce (jobs.dayforcehcm.com)
- Apply offers "Apply without an account". Use it (no account, faster).
- A privacy policy modal opens over the form: click the "I agree to the privacy statement" label, then Save.
- LinkedIn must be a full `https://www.linkedin.com/in/...` URL. Mobile needs the country code dropdown set to Australia (+61) and the number without the leading 0.
- Dropdowns: click, type the option text, Enter. Some (e.g. "How did you hear about this job?") don't respond to this: leave them for the user and say so.
- File inputs in page order: Import resume (parses into the form), Resume attachment, Cover letter, Additional documents (use it for transcripts).
- Steps: Candidate info, Questionnaire, Submit.

## Cornerstone (e.g. NSW Connect, *.csod.com)
- No account needed to submit (it offers "Create Profile" afterwards).
- Step 1: name, email, then the resume upload. It parses the resume and can fill County with the state. The resume upload sometimes doesn't register the first time: check for a "Delete file <name>" button and upload again if missing. Set Country after the resume parses, because parsing resets it.
- Step 2: radios and selects for work rights, DCS employment, redundancy, ADF service, disability, adjustments and diversity. Pick them by label text in JS.
- Step 3: a required "I agree" disclaimer (click its label). Step 4: Submit.

## iCIMS (*.icims.com)
- Apply Now → email page → a puzzle CAPTCHA (the user solves it). The puzzle expires: if it disappears and Next greys out, reload the login page, enter the email again, and ask the user to click Next and solve it straight away.
- The account and profile steps come after the CAPTCHA.

## applynow.net.au (councils and others)
- Usually asks for a full street address. Check Form answers has it before starting.
