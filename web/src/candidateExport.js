// Spreadsheet exports are generated locally from the authenticated candidate list.
export const EXPORT_COLUMNS = [
  ["name", "Name"], ["current_company", "Current company"], ["current_title", "Current title"],
  ["ctc_current_lpa", "Current CTC (LPA)"], ["ctc_expected_lpa", "Expected CTC (LPA)"],
  ["phone", "Phone number"], ["email", "Email"], ["top_skills", "Top skills"],
  ["total_exp_years", "Experience (years)"], ["location", "Location"],
  ["notice_days", "Notice period (days)"], ["status", "Recruitment status"],
  ["score", "Match score / 10"], ["band", "Match band"], ["origin", "Source"],
  ["profile_url", "Profile URL"]
];
const value = (candidate, key) => {
  const v = candidate[key];
  return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
};
// Prefix dangerous spreadsheet formulas, including after leading whitespace/control characters.
export const safeCell = (v) => /^[\s\u0000-\u001f]*[=+@\-]/.test(v) ? "'" + v : v;
const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function candidatesCsv(rows) {
  const quote = (v) => '"' + safeCell(v).replace(/"/g, '""') + '"';
  return "\uFEFF" + [EXPORT_COLUMNS.map(([, header]) => quote(header)).join(","),
    ...rows.map((row) => EXPORT_COLUMNS.map(([key]) => quote(value(row, key))).join(","))].join("\r\n");
}
// Produce a real Office Open XML workbook without an extra runtime dependency.
// ZIP entries use the STORE method; Excel opens the resulting .xlsx directly.
const utf8 = (text) => new TextEncoder().encode(text);
const xml = (s) => escapeXml(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const u16 = (n) => [n & 255, (n >>> 8) & 255];
const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [filename, content] of Object.entries(files)) {
    const name = utf8(filename), data = utf8(content), crc = crc32(data);
    const localHeader = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)
    ]);
    local.push(localHeader, name, data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
    ]), name);
    offset += localHeader.length + name.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(Object.keys(files).length), ...u16(Object.keys(files).length),
    ...u32(centralSize), ...u32(offset), ...u16(0)
  ]);
  return new Blob([...local, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
export function candidatesXlsx(rows) {
  const unique = [...new Map(rows.map((row) => [row.id ?? row.candidate_id ?? Symbol(), row])).values()];
  const cell = (v) => '<c t="inlineStr"><is><t xml:space="preserve">' + xml(safeCell(v)) + '</t></is></c>';
  const record = (values, index) => '<row r="' + index + '">' + values.map(cell).join("") + '</row>';
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    record(EXPORT_COLUMNS.map(([, header]) => header), 1) +
    unique.map((row, i) => record(EXPORT_COLUMNS.map(([key]) => value(row, key)), i + 2)).join("") +
    '</sheetData></worksheet>';
  return zip({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Candidates" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
    "xl/worksheets/sheet1.xml": sheet
  });
}
export function downloadCandidates(rows, format, mandateCode = "mandate") {
  if (!["csv", "excel"].includes(format)) throw new Error("Unsupported export format");
  const excel = format === "excel";
  const unique = [...new Map(rows.map((row) => [row.id ?? row.candidate_id ?? Symbol(), row])).values()];
  const content = excel ? candidatesXlsx(unique) : candidatesCsv(unique);
  const blob = excel ? content : new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `candidates-${String(mandateCode).replace(/[^a-zA-Z0-9_-]/g, "-")}-${new Date().toISOString().slice(0, 10)}.${excel ? "xlsx" : "csv"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
