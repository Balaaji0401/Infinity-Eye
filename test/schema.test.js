import test from "node:test";
import assert from "node:assert/strict";
import { ensureSchema, SCHEMA_STATEMENTS } from "../src/schema.js";

test("first-run schema uses complete prepared statements in one D1 batch", async () => {
  let batch = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        async first() { throw new Error("no such table: app_meta"); },
      };
    },
    async batch(statements) {
      batch = statements;
      return statements.map(() => ({ success: true }));
    },
    async exec() {
      assert.fail("multiline D1 exec must not be used for schema creation");
    },
  };

  await ensureSchema(db);

  assert.equal(batch.length, SCHEMA_STATEMENTS.length);
  assert.ok(batch.length > 10);
  assert.match(batch[0].sql, /^CREATE TABLE IF NOT EXISTS app_meta/);
  assert.match(batch.at(-1).sql, /^INSERT INTO app_meta/);
  assert.ok(batch.every(({ sql }) => !sql.trim().endsWith(";")));
});
