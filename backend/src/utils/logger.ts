import fs from 'fs';
import path from 'path';

const logFilePath = path.join(__dirname, '..', '..', 'error_logs.json');

export interface LogEntry {
  timestamp: string;
  action: string;
  error_message: string;
  python_stderr: string;
  context_data: any;
  how_to_fix_suggestion: string;
}

export function logError(entry: Omit<LogEntry, 'timestamp'>) {
  try {
    const logs = getLogs();
    const newLog: LogEntry = {
      timestamp: new Date().toISOString(),
      ...entry
    };
    logs.push(newLog);
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2), 'utf-8');
    console.error(`[ERROR GUARDADO] Acción: ${newLog.action} | Error: ${newLog.error_message}`);
  } catch (err) {
    console.error('No se pudo guardar el log:', err);
  }
}

export function getLogs(): LogEntry[] {
  try {
    if (fs.existsSync(logFilePath)) {
      const data = fs.readFileSync(logFilePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error leyendo logs:', err);
  }
  return [];
}
