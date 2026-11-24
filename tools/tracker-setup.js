// Builds the Google Sheets batch that turns a brand-new blank spreadsheet into a Job Hunt Tracker,
// or upgrades an older tracker to the current version.
//
//   node tracker-setup.js [outFile]                       new tracker
//   node tracker-setup.js --upgrade <fromVersion> <outFile> [configSheetId]   add what's new since that version
//     configSheetId: the Config tab's sheetId if it isn't 105 (read it with get_spreadsheet, fields sheets.properties)
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

const TRACKER_VERSION = 2;
const STATS_ID = 778;
const REPLIED = '^(Action needed|Assessment|Phone screen|Interview|Final interview|Offer|Rejected)$';

// Stats tab: overview, applications per week (with a chart), and reply rates by role group and by platform.
function statsRequests(index) {
  const S = STATS_ID;
  const r = [];
  r.push({ addSheet: { properties: { sheetId: S, title: 'Stats', index, gridProperties: { rowCount: 200, columnCount: 20 } } } });
  const applied = 'Jobs!I:I="Applied"';
  const sumIf = (re, extra = '') => `=SUMPRODUCT((${applied})${extra}*REGEXMATCH(Jobs!J:J&"","${re}"))`;
  const groupCols = (col, keyCol) => {
    // keyCol: Jobs column to group by (D = role group, M = applied via)
    const k = `Jobs!${keyCol}:${keyCol}`;
    const list = `FILTER(${col}5:${col},${col}5:${col}<>"")`;
    const map = (body) => `=IF(${col}5="None",,MAP(${list},LAMBDA(g,${body})))`;
    return [
      `=IFERROR(SORT(UNIQUE(FILTER(${k},${applied},${k}<>""))),"None")`,
      map(`COUNTIFS(${k},g,Jobs!I:I,"Applied")`),
      map(`SUMPRODUCT((${k}=g)*(${applied})*REGEXMATCH(Jobs!J:J&"","${REPLIED}"))`),
      map(`SUMPRODUCT((${k}=g)*(${applied})*REGEXMATCH(Jobs!J:J&"","${PROGRESS}"))`),
    ];
  };
  const g = groupCols('H', 'D');
  const p = groupCols('N', 'M');
  const rate = (col, a, b) => `=ARRAYFORMULA(IF(LEN(${col}5:${col})*(${col}5:${col}<>"None"),IFERROR(${b}5:${b}/${a}5:${a},0),))`;
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
    if (i === 0) row.push(...g, rate('H', 'I', 'J'), '', ...p, rate('N', 'O', 'P'));
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
  const from = Number(process.argv[3] || 1);
  const outFile = process.argv[4];
  const CONFIG = process.argv[5] ? Number(process.argv[5]) : ID.Config;
  const up = [];
  if (from < 2) {
    up.push(...statsRequests(2));
    // Config rows added in v2. Version 1 trackers have 10 rows (header + 9 keys), so these go in rows 11-13.
    up.push(writeRows(CONFIG, D.Config.filter((row) => ['min_salary', 'min_salary_action', 'tracker_version'].includes(row[0])), 10));
  }
  up.push(writeRows(CONFIG, [['tracker_version', TRACKER_VERSION, 'Set by the skill. Used to add new features to older trackers']], 12));
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
req.push({ repeatCell: { range: range(ID.Config, lastCheckRow, lastCheckRow + 1, 1, 2), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } });

req.push(...statsRequests(2));

const out = JSON.stringify({ requests: req });
if (process.argv[2]) { fs.writeFileSync(process.argv[2], out); console.log(`Wrote ${req.length} requests (${out.length} bytes) to ${process.argv[2]}`); }
else console.log(out);
