import { neon } from "@neondatabase/serverless";
import type { NeonAtomicExecutor, NeonRows } from "./neon-owner";

type FailureStage = "configuration" | "driver_initialization" | "transaction" | "result_contract";
type ConfigurationFailure = "empty" | "shell_command" | "quoted_url" | "invalid_url"
  | "protocol" | "hostname" | "username_encoding" | "role" | "password_missing"
  | "database_missing" | "port";
type TransactionFailure = "authentication" | "authorization" | "dns" | "tls"
  | "timeout" | "network" | "http_error";

/** Fixed labels and a bounded SQLSTATE only. Never pass raw driver errors,
 * connection strings, statements, parameters or identities to the logger. */
function reportFailure(stage: FailureStage, sqlState = "UNKNOWN", reason?: ConfigurationFailure | TransactionFailure, httpStatus?: number) {
  console.error("creditbook_neon_failure", { stage, sqlState, ...(reason ? { reason } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}) });
}

/** The installed driver's non-400 HTTP errors lack SQLSTATE. Inspect them only
 * to select closed labels; never return/log the message, body or source error. */
function transactionDiagnostic(error: unknown): { reason?: TransactionFailure; httpStatus?: number } {
  if (!error || typeof error !== "object") return {};
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const match = /^Server error \(HTTP status ([45]\d{2})\):/.exec(message);
  const httpStatus = match ? Number(match[1]) : undefined;
  const source = "sourceError" in error ? error.sourceError : undefined;
  const cause = source && typeof source === "object" && "cause" in source ? source.cause : undefined;
  const transport = cause && typeof cause === "object" ? cause : source;
  const transportCode = transport && typeof transport === "object" && "code" in transport ? transport.code : undefined;
  let reason: TransactionFailure | undefined;
  if (/password authentication failed|authentication failed|invalid password/i.test(message)) reason = "authentication";
  else if (/permission denied|insufficient privilege/i.test(message)) reason = "authorization";
  else if (transportCode === "ENOTFOUND" || transportCode === "EAI_AGAIN") reason = "dns";
  else if (typeof transportCode === "string"
    && ["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT"].includes(transportCode)) reason = "tls";
  else if (transportCode === "ETIMEDOUT" || transportCode === "UND_ERR_CONNECT_TIMEOUT"
    || ("name" in error && error.name === "TimeoutError") || /connection timed out|TimeoutError/i.test(message)) reason = "timeout";
  else if (message.startsWith("Error connecting to database:")) reason = "network";
  else if (httpStatus !== undefined) reason = "http_error";
  return { ...(reason ? { reason } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}) };
}

function configurationFailure(connectionString: string, role: string): ConfigurationFailure | null {
  const value = connectionString.trim();
  if (!value) return "empty";
  if (/^psql(?:\s|$)/i.test(value)) return "shell_command";
  if ((value.startsWith("'") && value.endsWith("'"))
    || (value.startsWith('"') && value.endsWith('"'))) return "quoted_url";
  let url: URL;
  try { url = new URL(connectionString); } catch { return "invalid_url"; }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) return "protocol";
  if (!/^[a-z0-9.-]+\.neon\.(tech|build)$/.test(url.hostname)) return "hostname";
  let username: string;
  try { username = decodeURIComponent(url.username); } catch { return "username_encoding"; }
  if (username !== role) return "role";
  if (!url.password) return "password_missing";
  if (url.pathname.length < 2) return "database_missing";
  if (url.port && url.port !== "5432") return "port";
  return null;
}

/** Server-only, explicitly constructed adapter. Never reads an ambient URL or
 * enables an application route. SQL text must be trusted server source. */
export function createNeonAtomicExecutor(connectionString: string, role: "creditbook_neon_gateway" | "creditbook_personal_gateway" = "creditbook_neon_gateway"): NeonAtomicExecutor {
  const reason = configurationFailure(connectionString, role);
  if (reason) {
    reportFailure("configuration", "UNKNOWN", reason);
    throw new Error("Valid Neon server connection required.");
  }
  const sql = (() => {
    try { return neon(connectionString); }
    catch {
      reportFailure("driver_initialization");
      throw new Error("Neon driver initialization failed.");
    }
  })();
  return async (statements, signal) => {
    signal?.throwIfAborted();
    if (!statements.length || statements.length > 53) throw new Error("Invalid SQL batch size.");
    const captured = statements.map(statement => ({ text: statement.text, values: [...statement.values] }));
    let stage: FailureStage = "transaction";
    try {
      const timeout = AbortSignal.timeout(30000);
      const rows: unknown = await sql.transaction(captured.map(statement => sql.query(statement.text, statement.values)), {
        isolationLevel: "ReadCommitted", arrayMode: false, fullResults: false,
        fetchOptions: { signal: signal ? AbortSignal.any([signal, timeout]) : timeout },
      });
      if (!Array.isArray(rows) || rows.length !== captured.length || !rows.every(group =>
        Array.isArray(group) && group.every(row => row !== null && typeof row === "object" && !Array.isArray(row)))) {
        stage = "result_contract";
        throw new Error("Invalid SQL result contract.");
      }
      return rows as readonly NeonRows[];
    } catch (error) {
      // Driver errors may contain SQL, endpoint or authentication details.
      const value = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const code = typeof value === "string" && /^[0-9A-Z]{5}$/.test(value) ? value : "UNKNOWN";
      const diagnostic = stage === "transaction" && code === "UNKNOWN" ? transactionDiagnostic(error) : {};
      reportFailure(stage, code, diagnostic.reason, diagnostic.httpStatus);
      throw Object.assign(new Error("Neon transaction failed; outcome may be unknown. Retry only with the same command key."), { code });
    }
  };
}
