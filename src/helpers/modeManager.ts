import fs from 'node:fs';
import path from 'node:path';

export function getFileSwitchState(filename: string): boolean {
  const filePath = path.join(process.cwd(), filename);
  return fs.existsSync(filePath);
}

class ModeManager {
  isPaperMode(): boolean {
    return getFileSwitchState('.paper');
  }

  isKillMode(): boolean {
    return getFileSwitchState('.kill');
  }

  isPanicMode(): boolean {
    return getFileSwitchState('.panic');
  }
}

export const modeManager = new ModeManager();
