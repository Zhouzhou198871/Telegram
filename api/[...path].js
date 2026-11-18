import worker from "../worker.js";
import postgres from "postgres";

export const config = { api: { bodyParser: false } };
let sqlClient;

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error("database_not_configured");
  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10
    });
  }
  return sqlClient;
}

function normalizeSql(source, previousChanges = 0) {
  let sql = String(source)
    .replace(/balance\s*=\s*printf\('%\.4f',\s*\((balance_units\s*[+-]\s*\?)\s*\/\s*10000\.0\)\)/gi,
      "balance=ROUND(($1)/10000.0,4)")
    .replace(/\bchanges\s*\(\s*\)/gi, String(Number(previousChanges) || 0));
  let index = 0;
  return sql.replace(/\?/g, () => "$" + (++index));
}

class NeonStatement {
  constructor(db, source) { this.db = db; this.source = source; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    const rows = await this.db.execute(this.source, this.params);
    return rows[0] || null;
  }
  async all() {
    const rows = await this.db.execute(this.source, this.params);
    return { success: true, results: rows };
  }
  async run() {
    const result = await this.db.executeWithMeta(this.source, this.params);
    return { success: true, meta: { changes: result.changes }, results: result.rows };
  }
}

class NeonD1Compat {
  constructor(client) { this.client = client; }
  prepare(source) { return new NeonStatement(this, source); }
  async execute(source, params = [], tx = this.client, previousChanges = 0) {
    const statement = normalizeSql(source, previousChanges);
    const rows = await tx.unsafe(statement, params);
    return Array.from(rows);
  }
  async executeWithMeta(source, params = [], tx = this.client, previousChanges = 0) {
    let statement = normalizeSql(source, previousChanges);
    const command = statement.trim().match(/^([a-z]+)/i)?.[1]?.toUpperCase();
    const isMutation = ["INSERT", "UPDATE", "DELETE"].includes(command);
    if (isMutation && !/\bRETURNING\b/i.test(statement)) {
      statement += " RETURNING 1 AS __d1_changed";
    }
    const result = await tx.unsafe(statement, params);
    const rows = Array.from(result);
    return { rows, changes: isMutation ? rows.length : 0 };
  }
  async batch(statements) {
    return this.client.begin(async tx => {
      const output = [];
      let previousChanges = 0;
      for (const statement of statements) {
        const result = await this.executeWithMeta(statement.source, statement.params, tx, previousChanges);
        previousChanges = result.changes;
        output.push({ success: true, results: result.rows, meta: { changes: result.changes } });
      }
      return output;
    });
  }
}

function makeHeaders(source) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(source || {})) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, String(value));
  }
  return headers;
}

export default async function handler(req, res) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    const headers = makeHeaders(req.headers);
    const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost";
    const proto = headers.get("x-forwarded-proto") || "https";
    const url = new URL(req.url || "/", proto + "://" + host);
    const routePath = req.query?.path;
    if (Array.isArray(routePath) && routePath.length) url.pathname = "/api/" + routePath.map(String).join("/");
    else if (typeof routePath === "string" && routePath) url.pathname = "/api/" + routePath;
    if (url.pathname === "/api/health") url.pathname = "/health";
    console.log("qingtian-api-route", req.url, JSON.stringify(req.query || {}), url.pathname);
    const chunks = [];
    if (!["GET", "HEAD"].includes(method)) {
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, {
      method,
      headers,
      ...(rawBody ? { body: rawBody, duplex: "half" } : {})
    });
    const env = { ...process.env, DB: new NeonD1Compat(getSql()) };
    const response = await worker.fetch(request, env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
    });
    if (typeof response.headers.getSetCookie === "function") {
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
    } else {
      const cookie = response.headers.get("set-cookie");
      if (cookie) res.setHeader("Set-Cookie", cookie);
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
  }
}
