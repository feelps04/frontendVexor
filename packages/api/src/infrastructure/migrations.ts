import type { Pool } from 'pg';
import path from 'path';

type Migration = { version: string; filename: string; sql: string };

async function loadMigrations(): Promise<Migration[]> {
  const fs = await import('fs/promises');
  const dir = path.join(process.cwd(), 'packages', 'api', 'migrations');

  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // allow running without migrations folder mounted
    return [];
  }

  const sqlFiles = entries
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b));

  const migrations: Migration[] = [];
  for (const filename of sqlFiles) {
    const version = filename.split('_')[0];
    const sql = await fs.readFile(path.join(dir, filename), 'utf8');
    migrations.push({ version, filename, sql });
  }
  return migrations;
}

export async function runMigrations(pg: Pool): Promise<void> {
  const migrations = await loadMigrations();
  if (migrations.length === 0) return;

  await pg.query('BEGIN');
  try {
    // Ensure schema table exists
    await pg.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`
    );

    const appliedRes = await pg.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRes.rows.map((r) => r.version));

    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      await pg.query(m.sql);
      await pg.query('INSERT INTO schema_migrations(version) VALUES ($1)', [m.version]);
    }

    await pg.query('COMMIT');
  } catch (err) {
    await pg.query('ROLLBACK');
    throw err;
  }
}
