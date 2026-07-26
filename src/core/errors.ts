/**
 * Errors that are safe to show a user. Never carries a stack trace or a raw
 * upstream body into the model's context — only a short, human sentence.
 */
export class SourceError extends Error {
  constructor(
    readonly source: string,
    message: string,
    /** Timeouts, dropped connections and 5xx are worth one retry. A 404 is not. */
    readonly transient: boolean = false,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

/** Diagnostics go to stderr only — stdout belongs to the MCP protocol. */
export function logErr(message: string): void {
  process.stderr.write(`[hyperevm-mcp] ${message}\n`);
}

/** One-line, non-leaky description of an unknown thrown value. */
export function describe(err: unknown): string {
  if (err instanceof SourceError) return err.message;
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}
