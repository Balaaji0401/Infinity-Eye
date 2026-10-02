// Parse a Naukri Resdex export (xlsx/xls/csv) in the browser into plain row objects.
import * as XLSX from "xlsx";

export async function parseNaukriExport(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  let rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  // Some exports have a title row above the header: detect a row whose values look like headers.
  if (rows.length && !Object.keys(rows[0]).some((k) => /name/i.test(k))) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    const hi = aoa.findIndex((r) => r.some((v) => /name/i.test(String(v))) && r.filter(Boolean).length >= 3);
    if (hi >= 0) {
      const header = aoa[hi].map((h, i) => String(h || `col${i}`));
      rows = aoa.slice(hi + 1).filter((r) => r.some((v) => String(v).trim())).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
    }
  }
  return rows;
}
