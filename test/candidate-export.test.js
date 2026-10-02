import test from "node:test";
import assert from "node:assert/strict";
import { candidatesCsv, candidatesXlsx, EXPORT_COLUMNS, safeCell } from "../web/src/candidateExport.js";

test("CSV includes required columns and escapes unsafe cells", () => {
  const csv = candidatesCsv([{ id: 1, name: "A, B", current_company: "=test", phone: "+919876543210", top_skills: ["React", "Node"] }]);
  assert.ok(csv.includes('"Current company"'));
  assert.ok(csv.includes('"A, B"'));
  assert.ok(csv.includes('"React, Node"'));
  assert.ok(csv.includes("'=test"));
  assert.equal(csv.split("\r\n").length, 2);
  assert.equal(EXPORT_COLUMNS.length, 16);
});
test("formula-like values are escaped", () => {
  assert.equal(safeCell("=test"), "'=test");
  assert.equal(safeCell("normal"), "normal");
});
test("XLSX contains an Excel worksheet and deduplicated rows", async () => {
  const blob = candidatesXlsx([{ id: 1, name: "Alice & Bob" }, { id: 1, name: "Alice & Bob" }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
  const content = new TextDecoder().decode(bytes);
  assert.ok(content.includes("xl/worksheets/sheet1.xml"));
  assert.ok(content.includes("Alice &amp; Bob"));
  assert.equal((content.match(/<row r="/g) || []).length, 2);
});
