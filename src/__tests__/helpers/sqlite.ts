import { readFileSync, readdirSync } from 'node:fs';
import {
    DatabaseSync,
    type SQLInputValue,
    type SQLOutputValue,
} from 'node:sqlite';
import { URL } from 'node:url';

interface Statement {
    bind(...values: SQLInputValue[]): Statement;
    all(): Promise<{
        results: Record<string, SQLOutputValue>[];
        success: boolean;
    }>;
    first(): Promise<Record<string, SQLOutputValue> | null>;
    run(): { success: boolean };
}

interface SqliteFixture {
    sqlite: DatabaseSync;
    db: D1Database;
    queries: string[];
}

/** Real SQLite behind the subset of D1 used by aggregate/store integration tests. */
export function sqliteDb(includeRollup = true): SqliteFixture {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON');
    const migrations = new URL('../../../drizzle/', import.meta.url);
    for (const file of readdirSync(migrations)
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        if (!includeRollup && file === '0007_usage_daily.sql') continue;
        sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
    const queries: string[] = [];
    function prepare(sql: string, args: SQLInputValue[] = []): Statement {
        return {
            bind(...values: SQLInputValue[]) {
                return prepare(sql, values);
            },
            async all() {
                queries.push(sql);
                return {
                    results: sqlite.prepare(sql).all(...args),
                    success: true,
                };
            },
            async first() {
                queries.push(sql);
                return sqlite.prepare(sql).get(...args) ?? null;
            },
            run() {
                queries.push(sql);
                sqlite.prepare(sql).run(...args);
                return { success: true };
            },
        };
    }
    const db = {
        prepare,
        async batch(statements: ReturnType<typeof prepare>[]) {
            sqlite.exec('BEGIN');
            try {
                const results = [];
                for (const statement of statements)
                    results.push(statement.run());
                sqlite.exec('COMMIT');
                return results;
            } catch (error) {
                sqlite.exec('ROLLBACK');
                throw error;
            }
        },
    } as unknown as D1Database;
    return { sqlite, db, queries };
}
