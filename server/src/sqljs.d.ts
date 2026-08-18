/** Minimal ambient typing for sql.js (WASM SQLite) — only the surface we use. */
declare module "sql.js" {
  interface SqlJsDatabase {
    run(sql: string, params?: unknown[]): SqlJsDatabase;
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
    export(): Uint8Array;
    close(): void;
  }
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
  }
  export default function initSqlJs(cfg?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
