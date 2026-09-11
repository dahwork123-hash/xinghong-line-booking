import { DatabaseSync } from "node:sqlite";

export function createDatabase(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
  const wrap = (sql, params = []) => ({
    sql,
    params,
    bind(...args) {
      return wrap(sql, args);
    },
    async first(column) {
      const row = db.prepare(sql).get(...params) || null;
      return column ? (row?.[column] ?? null) : row;
    },
    async all() {
      return {
        results: db.prepare(sql).all(...params),
        success: true,
        meta: {},
      };
    },
    async run() {
      const r = db.prepare(sql).run(...params);
      return {
        success: true,
        meta: {
          changes: Number(r.changes),
          last_row_id: Number(r.lastInsertRowid),
        },
      };
    },
  });
  return {
    raw: db,
    prepare: (sql) => wrap(sql),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const s of statements) {
          const prepared = db.prepare(s.sql);
          if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(s.sql))
            results.push({
              results: prepared.all(...s.params),
              success: true,
              meta: {},
            });
          else {
            const r = prepared.run(...s.params);
            results.push({
              success: true,
              meta: { changes: Number(r.changes) },
            });
          }
        }
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
