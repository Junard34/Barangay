import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsPython = resolve(projectRoot, '.venv', 'Scripts', 'python.exe');
const unixPython = resolve(projectRoot, '.venv', 'bin', 'python');
const python = process.env.PYTHON
  || (process.platform === 'win32' && existsSync(windowsPython) ? windowsPython : null)
  || (process.platform !== 'win32' && existsSync(unixPython) ? unixPython : null)
  || 'python';

let port = 8001;
try {
  const serviceUrl = new URL(process.env.ML_SERVICE_URL || 'http://127.0.0.1:8001');
  port = Number(serviceUrl.port || (serviceUrl.protocol === 'https:' ? 443 : 80));
} catch (error) {
  console.error(`Invalid ML_SERVICE_URL: ${error.message}`);
  process.exit(1);
}

const child = spawn(
  python,
  ['-m', 'uvicorn', 'ml_service.main:app', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: projectRoot, stdio: 'inherit' }
);

child.on('error', (error) => {
  console.error(`Could not start the Python ML service with "${python}": ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
  } else {
    process.exitCode = code ?? 1;
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
