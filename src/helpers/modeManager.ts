import fs from 'node:fs';
import path from 'node:path';

export function getFileSwitchState(filename: string): boolean {
  const filePath = path.join(process.cwd(), filename);
  return fs.existsSync(filePath);
}

class ModeManager {
  isPaperMode(): boolean {
    return getFileSwitchState('.paper') || process.env.LIVE_ENABLED !== 'true';
  }

  isKillMode(): boolean {
    return getFileSwitchState('.kill');
  }

  isPanicMode(): boolean {
    return getFileSwitchState('.panic');
  }
}

export const modeManager = new ModeManager();
