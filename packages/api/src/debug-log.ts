/**
 * Fallback debug logging: append NDJSON to .cursor/debug.log for runtime evidence.
 */
import path from 'path';
import fs from 'fs';

const LOG_PATH = process.env.DEBUG_LOG_PATH ?? path.join(process.cwd(), '.cursor', 'debug.log');

export function debugLog(payload: {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp?: number;
  hypothesisId?: string;
}): void {
  const line = JSON.stringify({ ...payload, timestamp: payload.timestamp ?? Date.now() }) + '\n';
  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    // ignore
  }
}
