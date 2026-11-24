// Builds the Google Sheets batch that turns a brand-new blank spreadsheet into a Job Hunt Tracker.
//
//   node tracker-setup.js [outFile]
//
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
req.push({ repeatCell: { range: range(ID.Config, lastCheckRow, lastCheckRow + 1, 1, 2), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } });

const out = JSON.stringify({ requests: req });
if (process.argv[2]) { fs.writeFileSync(process.argv[2], out); console.log(`Wrote ${req.length} requests (${out.length} bytes) to ${process.argv[2]}`); }
else console.log(out);
