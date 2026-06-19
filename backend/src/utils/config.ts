import path from 'path';
import fs from 'fs';

export function getConfigPath(): string {
  const pathsToTry = [
    path.join(__dirname, 'config.json'),
    path.join(__dirname, '..', 'config.json'),
    path.join(__dirname, '..', '..', 'src', 'config.json'),
    path.join(__dirname, '..', 'src', 'config.json'),
    path.join(__dirname, '..', '..', 'config.json'),
    path.join(process.cwd(), 'src', 'config.json'),
    path.join(process.cwd(), 'backend', 'src', 'config.json'),
  ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  // Si no existe, devolvemos una ruta por defecto en la carpeta src
  if (process.cwd().endsWith('backend')) {
    return path.join(process.cwd(), 'src', 'config.json');
  }
  return path.join(process.cwd(), 'backend', 'src', 'config.json');
}
