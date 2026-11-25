// Builds the Google Sheets batch that turns a brand-new blank spreadsheet into a Job Hunt Tracker,
// or upgrades an older tracker to the current version.
//
//   node tracker-setup.js <outFile> --part 1      new tracker, first call: tabs, headers, formulas, dropdowns, colours, settings
//   node tracker-setup.js <outFile> --part 2      second call: Stats tab and the easier-to-read layout
//   node tracker-setup.js <outFile> --part 3      third call: extra Stats charts, Read me tab, heading notes
//   node tracker-setup.js <outFile>               all three in one batch (large; prefer the parts)
//   node tracker-setup.js --upgrade <fromVersion> <outFile> --config-row <firstEmptyConfigRow> [--form-row <firstEmptyFormAnswersRow>] [--meta <sheets.json>]
//     --config-row: 1-based row after the last filled row of Config!A:A, so new settings never overwrite the user's rows
//     --meta: saved get_spreadsheet result (fields sheets.properties) for trackers whose tab IDs aren't the setup defaults
//
// TRACKER_VERSION is written to the Config tab (key tracker_version). Version 1 had no tracker_version row.
// Reads ../templates/tracker-defaults.json and ../user/profile.json (locale, timezone, group labels).
// Prints (or writes) {"requests": [...]} for ONE update_spreadsheet call on a spreadsheet just
// created with Drive create_file (contentMimeType application/vnd.google-apps.spreadsheet),
// whose first tab is "Sheet1" with sheetId 0.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'tracker-defaults.json'), 'utf8'));
const profPath = path.join(ROOT, 'user', 'profile.json');
const P = fs.existsSync(profPath) ? JSON.parse(fs.readFileSync(profPath, 'utf8')) : {};
const groups = ((P.targets && P.targets.groups) || []).map((g) => g.label).filter(Boolean);
const TYPES = groups.length ? groups : ['Main', 'Also'];
const LEVEL = String(P.level || 'any').toLowerCase().trim();
// Switch level-specific rules and sources on or off (column A = Enabled, column B = name).
const levelOn = (name) => { const only = (D._levels || {})[name]; return !only || only.includes(LEVEL) ? 'Y' : 'N'; };
for (const tab of ['Auto-drop', 'Sources']) for (const row of D[tab] || []) row[0] = row[0] === 'N' ? 'N' : levelOn(row[1]);

const ID = { Jobs: 0, 'Follow-ups': 777, 'Auto-drop': 101, Sources: 102, 'Search terms': 103, 'Target companies': 104, Config: 105 };
const JOB_COLS = ['ID', 'Company', 'Role', 'Type', 'Location', 'Work mode', 'Pay', 'Fit', 'Status', 'Stage', 'Found', 'Applied', 'Applied via', 'Listed on', 'Link', 'Contact', 'Contact email', 'Follow-up due', 'Next action', 'Last update', 'Notes'];
const JOB_WIDTHS = [50, 200, 260, 70, 140, 90, 90, 90, 100, 130, 95, 95, 140, 140, 230, 230, 230, 105, 260, 95, 420];
const HEAD = {
  'Auto-drop': ['Enabled', 'Rule', 'Match in', 'Keywords (comma separated, any one matches)', 'Action', 'Why'],
  Sources: ['Enabled', 'Source', 'Use for', 'How', 'Notes'],
  'Search terms': ['Enabled', 'Term', 'Group', 'Notes'],
  'Target companies': ['Enabled', 'Company', 'Careers page', 'Notes'],
  Config: ['Key', 'Value', 'Meaning'],
};
const STATUS = ['Shortlisted', 'Applied', 'Skipped', 'Dropped', 'Expired'];
const STAGE = ['Awaiting reply', 'Acknowledged', 'Action needed', 'Assessment', 'Phone screen', 'Interview', 'Final interview', 'Offer', 'Rejected', 'Withdrawn', 'No reply (closed)'];
const FIT = ['strong', 'good', 'stretch', 'mismatch'];
const TEAL = { red: 0.12, green: 0.31, blue: 0.27 };
const WHITE = { red: 1, green: 1, blue: 1 };

// pasteData parses each cell like typing it in (numbers, dates, formulas), and is far smaller than updateCells.
const writeRows = (sheetId, rows, rowIndex = 0, columnIndex = 0) => ({
  pasteData: {
    coordinate: { sheetId, rowIndex, columnIndex },
    data: rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : String(v))).join('\t')).join('\n'),
    type: 'PASTE_NORMAL', delimiter: '\t',
  },
});
const range = (sheetId, r0, r1, c0, c1) => {
  const g = { sheetId };
  if (r0 !== undefined) g.startRowIndex = r0;
  if (r1 !== undefined) g.endRowIndex = r1;
  if (c0 !== undefined) g.startColumnIndex = c0;
  if (c1 !== undefined) g.endColumnIndex = c1;
  return g;
};
const headerFmt = (sheetId, c0, c1, r = 0) => ({
  repeatCell: {
    range: range(sheetId, r, r + 1, c0, c1),
    cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColorStyle: { rgbColor: WHITE } }, backgroundColorStyle: { rgbColor: TEAL } } },
    fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColorStyle,userEnteredFormat.backgroundColorStyle',
  },
});
const dropdown = (sheetId, col, list, strict = true) => ({
  setDataValidation: {
    range: range(sheetId, 1, undefined, col, col + 1),
    rule: { condition: { type: 'ONE_OF_LIST', values: list.map((v) => ({ userEnteredValue: v })) }, strict, showCustomUi: true },
  },
});
const width = (sheetId, c0, c1, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c0, endIndex: c1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
const dateFmt = (sheetId, c, r0 = 1) => ({ repeatCell: { range: range(sheetId, r0, undefined, c, c + 1), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } });
const freeze = (sheetId, rows, cols = 0) => ({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: rows, frozenColumnCount: cols } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
const cf = (index, formula, format) => ({ addConditionalFormatRule: { index, rule: { ranges: [range(0, 1, undefined, 0, 21)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, format } } } });
const bg = (red, green, blue) => ({ backgroundColorStyle: { rgbColor: { red, green, blue } } });

const PROGRESS = '^(Assessment|Phone screen|Interview|Final interview|Offer)$';
const FOLLOW = [
  ['="Applied "&COUNTIF(Jobs!I:I,"Applied")&"   ·   Waiting "&(COUNTIFS(Jobs!I:I,"Applied",Jobs!J:J,"Awaiting reply")+COUNTIFS(Jobs!I:I,"Applied",Jobs!J:J,"Acknowledged"))&"   ·   In progress "&SUMPRODUCT(REGEXMATCH(Jobs!J:J&"","' + PROGRESS + '"))&"   ·   Rejected "&COUNTIF(Jobs!J:J,"Rejected")&"   ·   Shortlisted "&COUNTIF(Jobs!I:I,"Shortlisted")'],
  ['Calculated live from the Jobs tab. Edit the Jobs tab, not this one.'],
  ['Action needed', '', '', '', '', 'In progress', '', '', '', '', 'Follow-up due', '', '', '', '', '', 'Shortlist past expiry'],
  ['ID', 'Company', 'Role', 'Next action', '', 'ID', 'Company', 'Stage', 'Next action', '', 'ID', 'Company', 'Role', 'Applied', 'Days waiting', '', 'ID', 'Company', 'Role', 'Found'],
  [
    '=IFERROR(FILTER({Jobs!A:A,Jobs!B:B,Jobs!C:C,Jobs!S:S},Jobs!J:J="Action needed"),"None")', '', '', '', '',
    '=IFERROR(FILTER({Jobs!A:A,Jobs!B:B,Jobs!J:J,Jobs!S:S},REGEXMATCH(Jobs!J:J&"","' + PROGRESS + '")),"None")', '', '', '', '',
    '=IFERROR(FILTER({Jobs!A:A,Jobs!B:B,Jobs!C:C,Jobs!L:L,IFERROR(TODAY()-Jobs!L:L,"")},Jobs!I:I="Applied",REGEXMATCH(Jobs!J:J&"","^(Awaiting reply|Acknowledged|)$"),ISNUMBER(Jobs!R:R),Jobs!R:R<=TODAY()),"None")', '', '', '', '', '',
    '=IFERROR(FILTER({Jobs!A:A,Jobs!B:B,Jobs!C:C,Jobs!K:K},Jobs!I:I="Shortlisted",ISNUMBER(Jobs!K:K),Jobs!K:K<TODAY()-VLOOKUP("shortlist_expiry_days",Config!A:B,2,FALSE)),"None")',
  ],
];

const TRACKER_VERSION = 6;
const FORM_ID = 779;
const configDropdown = (configId, rowIndex, options) => ({ setDataValidation: { range: range(configId, rowIndex, rowIndex + 1, 1, 2), rule: { condition: { type: 'ONE_OF_LIST', values: options.map((v) => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true } } });
const passwordDropdown = (configId, rowIndex) => configDropdown(configId, rowIndex, ['Chrome suggests', 'I type it']);
// v6 Config settings that speed up applying, with their dropdown options.
const V6_CONFIG = { auto_agree_terms: ['Yes', 'No'], account_creation: ['Create', 'Ask'] };
// Form answers rows added in v6 (they come after the 39 v5 rows in tracker-defaults.json).
const V5_FORM_ROWS = 39;

// v5: a "Form answers" tab: standard answers for application forms and account sign-ups, which the user can
// edit or add to. Never holds passwords.
function formAnswersRequests(index, ids) {
  const S = FORM_ID;
  const head = ['Field', 'Answer', 'Notes', 'Group'];
  const r = [];
  r.push({ addSheet: { properties: { sheetId: S, title: 'Form answers', ...(index === undefined ? {} : { index }), gridProperties: { rowCount: 200, columnCount: 6 }, tabColorStyle: { rgbColor: { red: 0.55, green: 0.4, blue: 0.75 } } } } });
  r.push(writeRows(S, [head, ...(D['Form answers'] || [])]));
  r.push(headerFmt(S, 0, 4), freeze(S, 1));
  r.push({ repeatCell: { range: range(S, 1, undefined, 0, 4), cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment' } });
  r.push({ repeatCell: { range: range(S, 1, undefined, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
  r.push({ repeatCell: { range: range(S, 1, undefined, 1, 2), cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.97, green: 0.96, blue: 1 } } } }, fields: 'userEnteredFormat.backgroundColorStyle' } });
  r.push(width(S, 0, 1, 300), width(S, 1, 2, 320), width(S, 2, 3, 380), width(S, 3, 4, 150));
  r.push({ updateCells: { start: { sheetId: S, rowIndex: 0, columnIndex: 0 }, rows: [{ values: [
    { note: 'About this tab: standard answers Claude uses to fill application forms and account sign-up pages. Edit any answer or add new rows. Blank answers are asked each time (and Claude offers to save your reply here). NEVER put passwords here: you always type those yourself.' },
    { note: 'Leave blank, or write "Ask me", to be asked each time.' }] }], fields: 'note' } });
  // A line on the Read me tab (row 37), below the colour key.
  r.push(writeRows(README_ID, [['Form answers tab', 'Standard answers for application forms and account sign-ups (contact details, address, salary, notice period, licences, voluntary diversity questions...). Blank answers are asked each time. Passwords are never stored.', 'Yes: edit any answer or add rows.']], 36));
  r.push({ repeatCell: { range: range(README_ID, 36, 37, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
  return r;
}

// v3: easier to read. Saved filter views, no text spilling into the next cell, even row heights,
// short dates, the first three columns frozen, contact columns folded into a group, and wrapped
// text on the settings tabs. `ids` maps tab titles to sheetIds (they differ on uploaded trackers).
function readabilityRequests(ids) {
  const J = ids.Jobs;
  const r = [];
  const fmt = (sheetId, r0, r1, c0, c1, f, fields) => ({ repeatCell: { range: range(sheetId, r0, r1, c0, c1), cell: { userEnteredFormat: f }, fields } });
  // Jobs: compact, no spill-over, middle-aligned, 10pt.
  r.push(fmt(J, 1, undefined, 0, 21, { wrapStrategy: 'CLIP', verticalAlignment: 'MIDDLE', textFormat: { fontSize: 10 } }, 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment,userEnteredFormat.textFormat.fontSize'));
  r.push(fmt(J, 0, 1, 0, 21, { wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' }, 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment'));
  r.push({ updateDimensionProperties: { range: { sheetId: J, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } });
  r.push({ updateDimensionProperties: { range: { sheetId: J, dimension: 'ROWS', startIndex: 1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } });
  // Short dates, centred: Found, Applied, Follow-up due, Last update. ID and Fit centred too.
  for (const c of [10, 11, 17, 19]) r.push(fmt(J, 1, undefined, c, c + 1, { numberFormat: { type: 'DATE', pattern: 'd mmm yy' }, horizontalAlignment: 'CENTER' }, 'userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment'));
  for (const c of [0, 3, 7]) r.push(fmt(J, 1, undefined, c, c + 1, { horizontalAlignment: 'CENTER' }, 'userEnteredFormat.horizontalAlignment'));
  for (const c of [10, 11, 17, 19]) r.push(width(J, c, c + 1, 78));
  r.push(width(J, 0, 1, 44), width(J, 3, 4, 60), width(J, 7, 8, 70), width(J, 14, 15, 160), width(J, 20, 21, 360));
  // Light row lines.
  r.push({ updateBorders: { range: range(J, 0, undefined, 0, 21), innerHorizontal: { style: 'SOLID', width: 1, colorStyle: { rgbColor: { red: 0.88, green: 0.9, blue: 0.89 } } } } });
  // Keep ID, Company and Role in view when scrolling sideways.
  r.push({ updateSheetProperties: { properties: { sheetId: J, gridProperties: { frozenRowCount: 1, frozenColumnCount: 3 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
  // Fold away the contact columns (P:Q) and Last update (T). Click + above them to show them.
  for (const [a, b] of [[15, 17], [19, 20]]) {
    r.push({ addDimensionGroup: { range: { sheetId: J, dimension: 'COLUMNS', startIndex: a, endIndex: b } } });
    r.push({ updateDimensionGroup: { dimensionGroup: { range: { sheetId: J, dimension: 'COLUMNS', startIndex: a, endIndex: b }, depth: 1, collapsed: true }, fields: 'collapsed' } });
  }
  // Saved filter views (Data > Filter views, or the filter icon). They never change the real row order.
  const view = (title, hidden, sortCol) => ({ addFilterView: { filter: {
    title, range: range(J, 0, undefined, 0, 21),
    sortSpecs: [{ dimensionIndex: sortCol, sortOrder: 'DESCENDING' }],
    filterSpecs: Object.entries(hidden).map(([col, values]) => ({ columnIndex: Number(col), filterCriteria: { hiddenValues: values } })),
  } } });
  r.push(view('Active (newest first)', { 8: ['Dropped', 'Expired', 'Skipped'], 9: ['Rejected', 'Withdrawn', 'No reply (closed)'] }, 0));
  r.push(view('To decide (shortlisted)', { 8: ['Applied', 'Dropped', 'Expired', 'Skipped'] }, 0));
  r.push(view('Applications (latest first)', { 8: ['Shortlisted', 'Dropped', 'Expired', 'Skipped'] }, 11));
  r.push(view('Everything (newest first)', {}, 0));
  // Settings tabs: wrap the long text columns so they read as a list.
  const wrapCols = { 'Auto-drop': [1, 3, 5], Sources: [3, 4], 'Search terms': [3], 'Target companies': [2, 3], Config: [2] };
  const widths = { 'Auto-drop': { 3: 420, 5: 260 }, Sources: { 3: 420, 4: 320 }, 'Search terms': { 3: 300 }, 'Target companies': { 2: 260, 3: 300 }, Config: { 2: 420 } };
  for (const [tab, cols] of Object.entries(wrapCols)) {
    const sid = ids[tab];
    if (sid === undefined) continue;
    r.push(fmt(sid, 1, undefined, 0, 8, { verticalAlignment: 'TOP' }, 'userEnteredFormat.verticalAlignment'));
    for (const c of cols) r.push(fmt(sid, 1, undefined, c, c + 1, { wrapStrategy: 'WRAP' }, 'userEnteredFormat.wrapStrategy'));
    for (const [c, px] of Object.entries(widths[tab] || {})) r.push(width(sid, Number(c), Number(c) + 1, px));
  }
  return r;
}

// ---------- v4: explanations and more charts ----------
const README_ID = 776;

// A "Read me" tab at the front explaining every tab, the statuses and stages, and the colours.
function readmeRequests() {
  const M = README_ID;
  const r = [];
  r.push({ addSheet: { properties: { sheetId: M, title: 'Read me', index: 0, gridProperties: { rowCount: 60, columnCount: 4 }, tabColorStyle: { rgbColor: TEAL } } } });
  const rows = [
    ['Job Hunt Tracker: how to read it'],
    ['Claude fills this in during each job hunt. You can read it any time, here or in the Google Sheets app, and change the parts marked Yes in the "Can I edit it?" column. Hover over a column heading on Jobs or any of the settings tabs to see what that column means.'],
    [''],
    ['Tab', 'What it shows', 'Can I edit it?'],
    ['Jobs', 'Every role ever found, one row each, with a permanent ID (the number you use in "apply to 12"). Use a saved filter view (Data → Filter views, or the filter icon): Active, To decide, Applications or Everything, newest first. Contact details and Last update are folded away: click the + above them.', 'Yes: Status, Stage, Next action, Notes. Don\'t sort in place, delete rows or type in Follow-up due.'],
    ['Follow-ups', 'Your to-do list, worked out from Jobs: applications that need you to do something, interviews and assessments in progress, applications with no reply after the follow-up period, and shortlisted roles going stale.', 'No: it updates itself.'],
    ['Stats', 'How the search is going: reply and interview rates, roles found and applied each week, your pipeline, where applications stand, fit, and which role groups and job sites get replies.', 'No: it updates itself.'],
    ['Auto-drop', 'Screening rules. A role whose title or ad contains a rule\'s keywords is dropped (Drop) or kept with a warning (Flag).', 'Yes: switch rules on or off (Y/N), change Drop or Flag, add keywords or new rules.'],
    ['Sources', 'Where Claude searches and applies, and how.', 'Yes: switch sources on or off, add job boards.'],
    ['Search terms', 'The words searched on each job site, grouped like your target roles.', 'Yes: add or switch off terms.'],
    ['Target companies', 'Employers whose own careers pages are checked directly, because many local jobs never reach the big boards.', 'Yes: add employers, fill in Careers page.'],
    ['Config', 'Settings: locations, how many roles to find per run, how long before following up, minimum pay, and a few limits.', 'Yes: the Value column (not next_id or tracker_version).'],
    [''],
    ['Status (big picture)', 'Meaning'],
    ['Shortlisted', 'Found and passed screening; waiting for your yes.'],
    ['Applied', 'Application submitted.'],
    ['Skipped', 'You said no, or rejected it at the overview.'],
    ['Dropped', 'Screened out automatically (a dealbreaker, a repeat, or pay too low). Kept so it\'s never shown again.'],
    ['Expired', 'Shortlisted but no decision within the expiry days.'],
    [''],
    ['Stage (after applying)', 'Meaning'],
    ['Awaiting reply', 'Nothing heard yet.'],
    ['Acknowledged', 'An automatic "we got your application" email.'],
    ['Action needed', 'They asked you to do something (activate an account, book a time, send documents). See Next action.'],
    ['Assessment / Phone screen / Interview / Final interview', 'You\'re in their process. Say "prep me for <ID>" for interview prep.'],
    ['Offer', 'You got an offer.'],
    ['Rejected / Withdrawn / No reply (closed)', 'Finished.'],
    [''],
    ['Row colours on Jobs', ''],
    ['Pale yellow', 'Shortlisted, waiting on you'],
    ['Pale green', 'Applied'],
    ['Amber', 'Action needed'],
    ['Green, bold', 'Assessment, interview or offer'],
    ['Pink', 'Rejected'],
    ['Grey text', 'Dropped, expired or skipped'],
  ];
  r.push(writeRows(M, rows));
  const fmt = (r0, r1, c0, c1, f, fields) => ({ repeatCell: { range: range(M, r0, r1, c0, c1), cell: { userEnteredFormat: f }, fields } });
  r.push(fmt(0, 1, 0, 3, { textFormat: { bold: true, fontSize: 14 } }, 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize'));
  r.push({ mergeCells: { range: range(M, 1, 2, 0, 3), mergeType: 'MERGE_ALL' } });
  r.push(fmt(1, 2, 0, 3, { wrapStrategy: 'WRAP', textFormat: { italic: true } }, 'userEnteredFormat.wrapStrategy,userEnteredFormat.textFormat.italic'));
  r.push(fmt(4, 60, 0, 3, { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' }, 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment'));
  for (const hr of [3, 13, 20, 28]) r.push(headerFmt(M, 0, hr === 3 ? 3 : 2, hr));
  r.push(fmt(4, 12, 0, 1, { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold'));
  const swatch = (row, rgb, extra = {}) => fmt(row, row + 1, 0, 2, { backgroundColorStyle: { rgbColor: rgb }, ...extra }, `userEnteredFormat.backgroundColorStyle${extra.textFormat ? ',userEnteredFormat.textFormat' : ''}`);
  r.push(swatch(29, { red: 1, green: 0.97, blue: 0.88 }), swatch(30, { red: 0.9, green: 0.96, blue: 0.92 }), swatch(31, { red: 0.99, green: 0.91, blue: 0.7 }),
    swatch(32, { red: 0.72, green: 0.88, blue: 0.8 }, { textFormat: { bold: true } }), swatch(33, { red: 0.96, green: 0.79, blue: 0.77 }));
  r.push(fmt(34, 35, 0, 2, { textFormat: { foregroundColorStyle: { rgbColor: { red: 0.6, green: 0.63, blue: 0.65 } } } }, 'userEnteredFormat.textFormat.foregroundColorStyle'));
  r.push(width(M, 0, 1, 230), width(M, 1, 2, 560), width(M, 2, 3, 300));
  return r;
}

// Hover notes on each column heading (and an "About this tab" note on A1) for every tab with a header row.
function headerNotesRequests(ids) {
  const notes = {
    Jobs: [
      'About this tab: every role ever found, one row each. Use a filter view (Data → Filter views) to see Active roles, roles To decide, Applications or Everything.\n\nID: permanent number for the role. Use it to tell Claude what to do, e.g. "apply to 12" or "prep me for 12".',
      'The employer (or the recruitment agency, if the client isn\'t named).', 'Job title as advertised.', 'Which of your target role groups it belongs to.', 'Where the job is.', 'Onsite, hybrid or remote.', 'Pay, only if the ad states it.',
      'How well it matches you: strong, good, stretch or mismatch.', 'Big picture: Shortlisted, Applied, Skipped, Dropped or Expired. See the Read me tab.',
      'Where an application stands with the employer, e.g. Awaiting reply, Interview, Rejected. See the Read me tab.', 'Date Claude found the role.', 'Date the application was submitted.',
      'Where the application was submitted (SEEK, LinkedIn, Company site...).', 'Every job site the role was seen on.', 'Link to the job ad.', 'Hiring contacts found (name and job title).',
      'Contact email result: sent, drafted or none found, with the address and where it was published.', 'Worked out automatically: applied date plus the follow-up days in Config. Don\'t type here.',
      'What you need to do next and by when (e.g. an interview time).', 'When Claude last changed this row.', 'History and details, newest last, each with a date.'],
    'Auto-drop': ['About this tab: screening rules. Y switches a rule on, N off.', 'Name of the rule.', 'Where to look for the keywords: Title, Ad text, Company, or Any.', 'Comma-separated words or phrases. Any one of them matching triggers the rule.', 'Drop removes the role; Flag keeps it with a warning.', 'Why the rule exists (for you).'],
    Sources: ['About this tab: where Claude searches and applies. Y on, N off.', 'Job site or source name.', 'Search, Apply or Both.', 'How Claude uses it (filters, sign-in needed and so on).', 'Anything to know about it.'],
    'Search terms': ['About this tab: the words searched on each job site. Y on, N off.', 'The search words.', 'Which target role group the term is for.', 'Anything to know about it.'],
    'Target companies': ['About this tab: employers whose own careers pages are checked directly. Y on, N off.', 'Employer name.', 'Link to their careers page, if known.', 'Anything to know about it.'],
    Config: ['About this tab: settings. Change values in column B; the Meaning column explains each one. Don\'t change next_id or tracker_version.', 'The setting\'s value.', 'What the setting does.'],
  };
  const r = [];
  for (const [tab, list] of Object.entries(notes)) {
    if (ids[tab] === undefined) continue;
    r.push({ updateCells: { start: { sheetId: ids[tab], rowIndex: 0, columnIndex: 0 }, rows: [{ values: list.map((note) => ({ note })) }], fields: 'note' } });
  }
  return r;
}

// More Stats charts, each fed by a small data table in the "Chart data" block (rows 64 onward).
function statsExtraRequests() {
  const S = STATS_ID;
  const r = [];
  const base = 63; // row 64
  const statuses = ['Shortlisted', 'Applied', 'Skipped', 'Dropped', 'Expired'];
  const stages = ['Awaiting reply', 'Acknowledged', 'Action needed', 'Assessment', 'Phone screen', 'Interview', 'Final interview', 'Offer', 'Rejected', 'Withdrawn', 'No reply (closed)'];
  const fits = ['strong', 'good', 'stretch', 'mismatch'];
  const funnel = [
    ['Roles seen', '=COUNT(Jobs!A:A)'], ['Kept after screening', '=COUNTIFS(Jobs!A:A,">0",Jobs!I:I,"<>Dropped")'], ['Applied', '=B7'],
    ['Replied', '=B8'], ['Assessment or interview', '=B10'], ['Offer', '=B12'],
  ];
  const grid = [['Chart data (used by the charts above; it updates itself, so don\'t edit it)'],
    ['Pipeline', 'Roles', '', 'Status', 'Roles', '', 'Stage (applied roles)', 'Roles', '', 'Fit (not dropped)', 'Roles', '', 'Week starting', 'Applied so far']];
  for (let i = 0; i < 11; i++) {
    const row = new Array(14).fill('');
    if (funnel[i]) [row[0], row[1]] = funnel[i];
    if (statuses[i]) { row[3] = statuses[i]; row[4] = `=COUNTIF(Jobs!I:I,"${statuses[i]}")`; }
    if (stages[i]) { row[6] = stages[i]; row[7] = `=COUNTIFS(Jobs!I:I,"Applied",Jobs!J:J,"${stages[i]}")`; }
    if (fits[i]) { row[9] = fits[i]; row[10] = `=COUNTIFS(Jobs!H:H,"${fits[i]}",Jobs!I:I,"<>Dropped")`; }
    if (i < 8) { row[12] = `=D${5 + i}`; row[13] = `=COUNTIFS(Jobs!L:L,"<"&M${base + 3 + i}+7)`; }
    grid.push(row);
  }
  r.push(writeRows(S, grid, base));
  r.push({ repeatCell: { range: range(S, base, base + 1, 0, 14), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: TEAL } } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize,userEnteredFormat.textFormat.foregroundColorStyle' } });
  for (const [a, b] of [[0, 2], [3, 5], [6, 8], [9, 11], [12, 14]]) r.push(headerFmt(S, a, b, base + 1));
  r.push({ repeatCell: { range: range(S, base + 2, base + 10, 12, 13), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'd mmm' } } }, fields: 'userEnteredFormat.numberFormat' } });

  const src = (r0, r1, c) => ({ sourceRange: { sources: [range(S, r0, r1, c, c + 1)] } });
  const pos = (row, col, w, h = 280) => ({ overlayPosition: { anchorCell: { sheetId: S, rowIndex: row, columnIndex: col }, widthPixels: w, heightPixels: h } });
  const basic = (title, type, domain, series, position, extra = {}) => ({ addChart: { chart: { spec: { title, basicChart: {
    chartType: type, legendPosition: series.length > 1 ? 'BOTTOM_LEGEND' : 'NO_LEGEND', headerCount: 1,
    domains: [{ domain }], series: series.map((s) => ({ series: s, targetAxis: type === 'BAR' ? 'BOTTOM_AXIS' : 'LEFT_AXIS', dataLabel: { type: 'DATA' } })), ...extra } }, position } } });
  const pie = (title, domain, series, position) => ({ addChart: { chart: { spec: { title, pieChart: { legendPosition: 'RIGHT_LEGEND', domain, series, pieHole: 0.4 } }, position } } });
  const h0 = base + 1; // header row index of the chart data tables
  // Band 1 (next to the weekly chart): pipeline funnel.
  r.push(basic('Your pipeline', 'BAR', src(h0, h0 + 7, 0), [src(h0, h0 + 7, 1)], pos(14, 11, 480)));
  // Band 2: status, stage and fit.
  r.push(pie('All roles by status', src(h0, h0 + 6, 3), src(h0, h0 + 6, 4), pos(30, 0, 350)));
  r.push(basic('Where applications stand', 'BAR', src(h0, h0 + 12, 6), [src(h0, h0 + 12, 7)], pos(30, 3, 560)));
  r.push(pie('Fit of roles kept', src(h0, h0 + 5, 9), src(h0, h0 + 5, 10), pos(30, 11, 480)));
  // Band 3: reply rate by role group, applications and replies by platform, applications over time.
  r.push(basic('Reply rate by role group', 'COLUMN', src(3, 12, 7), [src(3, 12, 11)], pos(46, 0, 350)));
  r.push(basic('Applications and replies by platform', 'COLUMN', src(3, 12, 13), [src(3, 12, 14), src(3, 12, 15)], pos(46, 3, 560)));
  r.push(basic('Applications over time', 'LINE', src(h0, h0 + 9, 12), [src(h0, h0 + 9, 13)], pos(46, 11, 480)));
  return r;
}

// Tab IDs from a saved get_spreadsheet result (fields sheets.properties), or the IDs setup uses.
function tabIds(metaFile) {
  const ids = { ...ID };
  if (!metaFile) return ids;
  const raw = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const sheets = (raw.content || raw).sheets || [];
  for (const s of sheets) if (s.properties && s.properties.title) ids[s.properties.title] = s.properties.sheetId;
  return ids;
}
const STATS_ID = 778;
const REPLIED = '^(Action needed|Assessment|Phone screen|Interview|Final interview|Offer|Rejected)$';

// Formulas for the "By role group" (H:L) and "By platform" (N:R) tables, row 5. They only look at rows 5-62,
// so they never pick up the chart data block further down the tab.
function statsTableFormulas() {
  const applied = 'Jobs!I:I="Applied"';
  const groupCols = (col, keyCol) => {
    // keyCol: Jobs column to group by (D = role group, M = applied via)
    const k = `Jobs!${keyCol}:${keyCol}`;
    const list = `FILTER(${col}5:${col}62,${col}5:${col}62<>"")`;
    const map = (body) => `=IF(${col}5="None",,MAP(${list},LAMBDA(g,${body})))`;
    return [
      `=IFERROR(SORT(UNIQUE(FILTER(${k},${applied},${k}<>""))),"None")`,
      map(`COUNTIFS(${k},g,Jobs!I:I,"Applied")`),
      map(`SUMPRODUCT((${k}=g)*(${applied})*REGEXMATCH(Jobs!J:J&"","${REPLIED}"))`),
      map(`SUMPRODUCT((${k}=g)*(${applied})*REGEXMATCH(Jobs!J:J&"","${PROGRESS}"))`),
    ];
  };
  const rate = (col, a, b) => `=ARRAYFORMULA(IF(LEN(${col}5:${col}62)*(${col}5:${col}62<>"None"),IFERROR(${b}5:${b}62/${a}5:${a}62,0),))`;
  return { group: [...groupCols('H', 'D'), rate('H', 'I', 'J')], platform: [...groupCols('N', 'M'), rate('N', 'O', 'P')] };
}

// Stats tab: overview, applications per week (with a chart), and reply rates by role group and by platform.
function statsRequests(index) {
  const S = STATS_ID;
  const r = [];
  r.push({ addSheet: { properties: { sheetId: S, title: 'Stats', index, gridProperties: { rowCount: 200, columnCount: 20 } } } });
  const applied = 'Jobs!I:I="Applied"';
  const sumIf = (re, extra = '') => `=SUMPRODUCT((${applied})${extra}*REGEXMATCH(Jobs!J:J&"","${re}"))`;
  const { group, platform } = statsTableFormulas();
  const overview = [
    ['Roles seen', '=COUNT(Jobs!A:A)'],
    ['Shortlisted now', '=COUNTIF(Jobs!I:I,"Shortlisted")'],
    ['Applied', '=COUNTIF(Jobs!I:I,"Applied")'],
    ['Replied (not just auto replies)', sumIf(REPLIED)],
    ['Reply rate', '=IFERROR(B8/B7,0)'],
    ['Progressed (assessment or interview)', sumIf(PROGRESS)],
    ['Interview rate', '=IFERROR(B10/B7,0)'],
    ['Offers', '=COUNTIF(Jobs!J:J,"Offer")'],
    ['Rejected', '=COUNTIF(Jobs!J:J,"Rejected")'],
  ];
  const weeks = [7, 6, 5, 4, 3, 2, 1, 0].map((k, i) => {
    const row = 5 + i;
    return [`=TODAY()-WEEKDAY(TODAY(),3)-${7 * k}`, `=COUNTIFS(Jobs!K:K,">="&D${row},Jobs!K:K,"<"&D${row}+7)`, `=COUNTIFS(Jobs!L:L,">="&D${row},Jobs!L:L,"<"&D${row}+7)`];
  });
  const grid = [
    ['Stats'],
    ['Calculated live from the Jobs tab. "Replied" counts real replies (action needed, assessment, interview, offer or rejection), not automatic acknowledgements.'],
    ['Overview', '', '', 'Applications per week', '', '', '', 'By role group', '', '', '', '', '', 'By platform applied on'],
    ['Measure', 'Value', '', 'Week starting', 'Found', 'Applied', '', 'Group', 'Applied', 'Replied', 'Progressed', 'Reply rate', '', 'Platform', 'Applied', 'Replied', 'Progressed', 'Reply rate'],
  ];
  for (let i = 0; i < 9; i++) {
    const row = [...(overview[i] || ['', '']), ''];
    row.push(...(weeks[i] || ['', '', '']), '');
    if (i === 0) row.push(...group, '', ...platform);
    grid.push(row);
  }
  r.push(writeRows(S, grid));
  r.push({ repeatCell: { range: range(S, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize' } });
  r.push({ repeatCell: { range: range(S, 1, 2), cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColorStyle: { rgbColor: { red: 0.4, green: 0.45, blue: 0.43 } } } } }, fields: 'userEnteredFormat.textFormat.italic,userEnteredFormat.textFormat.foregroundColorStyle' } });
  r.push({ repeatCell: { range: range(S, 2, 3), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: TEAL } } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize,userEnteredFormat.textFormat.foregroundColorStyle' } });
  [[0, 2], [3, 6], [7, 12], [13, 18]].forEach(([a, b]) => r.push(headerFmt(S, a, b, 3)));
  const pct = (r0, r1, c) => ({ repeatCell: { range: range(S, r0, r1, c, c + 1), cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' } } }, fields: 'userEnteredFormat.numberFormat' } });
  r.push(pct(8, 9, 1), pct(10, 11, 1), pct(4, undefined, 11), pct(4, undefined, 17));
  r.push({ repeatCell: { range: range(S, 4, 12, 3, 4), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'd mmm' } } }, fields: 'userEnteredFormat.numberFormat' } });
  r.push({ updateSheetProperties: { properties: { sheetId: S, gridProperties: { frozenRowCount: 4 }, tabColorStyle: { rgbColor: { red: 0.25, green: 0.55, blue: 0.85 } } }, fields: 'gridProperties.frozenRowCount,tabColorStyle' } });
  r.push(width(S, 0, 1, 260), width(S, 1, 2, 80), width(S, 2, 3, 20), width(S, 3, 6, 95), width(S, 6, 7, 20), width(S, 7, 8, 160), width(S, 8, 12, 85), width(S, 12, 13, 20), width(S, 13, 14, 170), width(S, 14, 18, 85));
  const src = (c) => ({ sourceRange: { sources: [range(S, 3, 12, c, c + 1)] } });
  r.push({ addChart: { chart: {
    spec: { title: 'Roles found and applied per week', basicChart: { chartType: 'COLUMN', legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
      axis: [{ position: 'BOTTOM_AXIS', title: 'Week starting' }, { position: 'LEFT_AXIS', title: 'Roles' }],
      domains: [{ domain: src(3) }], series: [{ series: src(4), targetAxis: 'LEFT_AXIS' }, { series: src(5), targetAxis: 'LEFT_AXIS' }] } },
    position: { overlayPosition: { anchorCell: { sheetId: S, rowIndex: 14, columnIndex: 3 }, widthPixels: 560, heightPixels: 300 } },
  } } });
  return r;
}

// --upgrade <fromVersion>: only what an older tracker is missing.
if (process.argv[2] === '--upgrade') {
  const args = process.argv.slice(3);
  const flag = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined; };
  const from = Number(args[0] || 1);
  const outFile = args[1];
  // --meta: saved get_spreadsheet result (fields sheets.properties), for trackers whose tab IDs aren't the setup defaults.
  const ids = tabIds(flag('--meta'));
  // --config-row: first empty Config row (1-based). The skill reads Config!A:A and passes it, so rows the user added aren't overwritten.
  const nextRow = Number(flag('--config-row') || 0);
  if (!outFile || !(nextRow >= 2)) {
    console.error('Usage: node tracker-setup.js --upgrade <fromVersion> <outFile> --config-row <firstEmptyConfigRow> [--meta <sheets.json>]');
    process.exit(2);
  }
  const up = [];
  if (from < 2) {
    up.push(...statsRequests(2));
    // Config rows added in v2. tracker_version is written once, last, with the current version.
    up.push(writeRows(ids.Config, D.Config.filter((row) => ['min_salary', 'min_salary_action', 'tracker_version'].includes(row[0])), nextRow - 1));
  }
  if (from < 3) up.push(...readabilityRequests(ids));
  if (from < 4) {
    // Older Stats tabs looked down whole columns, which would pick up the new chart data. Rewrite those formulas first.
    if (from >= 2) { const f = statsTableFormulas(); up.push(writeRows(STATS_ID, [f.group], 4, 7), writeRows(STATS_ID, [f.platform], 4, 13)); }
    up.push(...statsExtraRequests(), ...readmeRequests(), ...headerNotesRequests(ids));
  }
  if (from < 5) {
    up.push(...formAnswersRequests(undefined, ids));
    // v5 Config row, below the v2 rows if this upgrade also added those.
    const pwRow = nextRow - 1 + (from < 2 ? 3 : 0);
    up.push(writeRows(ids.Config, D.Config.filter((row) => row[0] === 'account_passwords'), pwRow), passwordDropdown(ids.Config, pwRow));
  }
  if (from < 6) {
    // v6 Config rows, below any rows this upgrade already added.
    const row = nextRow - 1 + (from < 2 ? 3 : 0) + (from < 5 ? 1 : 0);
    const keys = Object.keys(V6_CONFIG);
    up.push(writeRows(ids.Config, keys.map((k) => D.Config.find((r) => r[0] === k)), row));
    keys.forEach((k, i) => up.push(configDropdown(ids.Config, row + i, V6_CONFIG[k])));
    // v6 Form answers rows. A tab made by this same upgrade (from < 5) already has them.
    if (from === 5) {
      const formRow = Number(flag('--form-row') || V5_FORM_ROWS + 2);
      up.push(writeRows(ids['Form answers'] ?? FORM_ID, D['Form answers'].slice(V5_FORM_ROWS), formRow - 1));
    }
  }
  // Trackers that already have a tracker_version row (v2 and later) get it updated by the skill, not here.
  const o = JSON.stringify({ requests: up });
  if (outFile) { fs.writeFileSync(outFile, o); console.log(`Wrote ${up.length} upgrade requests (${o.length} bytes) to ${outFile}`); } else console.log(o);
  process.exit(0);
}

const req = [];
req.push({ updateSpreadsheetProperties: { properties: { locale: P.locale || 'en_AU', timeZone: P.timezone || 'Australia/Sydney' }, fields: 'locale,timeZone' } });
req.push({ updateSheetProperties: { properties: { sheetId: 0, title: 'Jobs', gridProperties: { rowCount: 2000, columnCount: 21 } }, fields: 'title,gridProperties.rowCount,gridProperties.columnCount' } });
let idx = 1;
for (const name of ['Follow-ups', 'Auto-drop', 'Sources', 'Search terms', 'Target companies', 'Config']) {
  req.push({ addSheet: { properties: { sheetId: ID[name], title: name, index: idx++, gridProperties: { rowCount: name === 'Follow-ups' ? 300 : 200, columnCount: name === 'Follow-ups' ? 20 : 8 } } } });
}

// Jobs
req.push(writeRows(0, [JOB_COLS]));
req.push(writeRows(0, [['=ARRAYFORMULA(IF(ROW(L:L)=1,"Follow-up due",IF(ISNUMBER(L:L),L:L+VLOOKUP("follow_up_after_days",Config!A:B,2,FALSE),)))']], 0, 17));
req.push(headerFmt(0, 0, 21), freeze(0, 1, 2));
req.push({ setBasicFilter: { filter: { range: range(0, 0, undefined, 0, 21) } } });
for (let i = 0; i < JOB_WIDTHS.length;) {
  let j = i;
  while (j + 1 < JOB_WIDTHS.length && JOB_WIDTHS[j + 1] === JOB_WIDTHS[i]) j++;
  req.push(width(0, i, j + 1, JOB_WIDTHS[i]));
  i = j + 1;
}
[10, 11, 17, 19].forEach((c) => req.push(dateFmt(0, c)));
req.push(dropdown(0, 3, TYPES, false), dropdown(0, 7, FIT, false), dropdown(0, 8, STATUS), dropdown(0, 9, STAGE));
req.push(
  cf(0, '=$J2="Rejected"', bg(0.96, 0.79, 0.77)),
  cf(1, `=REGEXMATCH($J2,"${PROGRESS}")`, { ...bg(0.72, 0.88, 0.8), textFormat: { bold: true } }),
  cf(2, '=$J2="Action needed"', bg(0.99, 0.91, 0.7)),
  cf(3, '=$I2="Applied"', bg(0.9, 0.96, 0.92)),
  cf(4, '=$I2="Shortlisted"', bg(1, 0.97, 0.88)),
  cf(5, '=OR($I2="Dropped",$I2="Expired",$I2="Skipped")', { textFormat: { foregroundColorStyle: { rgbColor: { red: 0.6, green: 0.63, blue: 0.65 } } } }),
);

// Follow-ups
const F = ID['Follow-ups'];
req.push(writeRows(F, FOLLOW));
req.push({ repeatCell: { range: range(F, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize' } });
req.push({ repeatCell: { range: range(F, 1, 2), cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColorStyle: { rgbColor: { red: 0.4, green: 0.45, blue: 0.43 } } } } }, fields: 'userEnteredFormat.textFormat.italic,userEnteredFormat.textFormat.foregroundColorStyle' } });
req.push({ repeatCell: { range: range(F, 2, 3), cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: TEAL } } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.fontSize,userEnteredFormat.textFormat.foregroundColorStyle' } });
[[0, 4], [5, 9], [10, 15], [16, 20]].forEach(([a, b]) => req.push(headerFmt(F, a, b, 3)));
req.push(dateFmt(F, 13, 4), dateFmt(F, 19, 4));
req.push({ repeatCell: { range: range(F, 4, undefined, 14, 15), cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0' } } }, fields: 'userEnteredFormat.numberFormat' } });
req.push({ updateSheetProperties: { properties: { sheetId: F, gridProperties: { frozenRowCount: 4 }, tabColorStyle: { rgbColor: { red: 0.95, green: 0.7, blue: 0.2 } } }, fields: 'gridProperties.frozenRowCount,tabColorStyle' } });
req.push(width(F, 0, 20, 130));
[0, 5, 10, 16].forEach((c) => req.push(width(F, c, c + 1, 45)));
[4, 9, 15].forEach((c) => req.push(width(F, c, c + 1, 20)));
req.push(width(F, 3, 4, 260), width(F, 8, 9, 220));

// Config-style tabs
for (const name of ['Auto-drop', 'Sources', 'Search terms', 'Target companies', 'Config']) {
  const sid = ID[name];
  req.push(writeRows(sid, [HEAD[name], ...(D[name] || [])]));
  req.push(headerFmt(sid, 0, HEAD[name].length), freeze(sid, 1));
  if (HEAD[name][0] === 'Enabled') req.push(dropdown(sid, 0, ['Y', 'N']));
  req.push({ autoResizeDimensions: { dimensions: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: HEAD[name].length } } });
}
req.push(dropdown(ID['Auto-drop'], 2, ['Title', 'Ad text', 'Company', 'Any']), dropdown(ID['Auto-drop'], 4, ['Drop', 'Flag']));
req.push(dropdown(ID['Search terms'], 2, TYPES, false));
const lastCheckRow = D.Config.findIndex((r) => r[0] === 'last_follow_up_check') + 1;
req.push(passwordDropdown(ID.Config, D.Config.findIndex((r) => r[0] === 'account_passwords') + 1));
for (const [k, opts] of Object.entries(V6_CONFIG)) req.push(configDropdown(ID.Config, D.Config.findIndex((r) => r[0] === k) + 1, opts));
req.push({ repeatCell: { range: range(ID.Config, lastCheckRow, lastCheckRow + 1, 1, 2), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } });

// Sent as three calls so no batch is too big to send reliably: tabs and formulas, then Stats and layout, then extras.
const part2 = [...statsRequests(2), ...readabilityRequests(ID)];
const part3 = [...statsExtraRequests(), ...readmeRequests(), ...headerNotesRequests(ID), ...formAnswersRequests(8, ID)];

const argv = process.argv.slice(2);
const partFlag = argv.indexOf('--part');
const part = partFlag > -1 ? Number(argv[partFlag + 1]) : 0;
const outFile = argv.find((a, i) => !a.startsWith('--') && (partFlag < 0 || i !== partFlag + 1));
if (![0, 1, 2, 3].includes(part)) { console.error('--part must be 1, 2 or 3'); process.exit(2); }
const chosen = [[...req, ...part2, ...part3], req, part2, part3][part];
const out = JSON.stringify({ requests: chosen });
if (outFile) { fs.writeFileSync(outFile, out); console.log(`Wrote ${chosen.length} requests (${out.length} bytes) to ${outFile}${part ? ` (part ${part} of 3, send in order)` : ''}`); }
else console.log(out);
