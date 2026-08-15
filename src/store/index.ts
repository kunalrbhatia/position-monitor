import fs from 'node:fs';
import path from 'node:path';
import { Position, PositionSchema } from '../types/position.js';
import { notifyAlert } from '../alerts/notifier.js';

export interface TickInfo {
  ltp: number;
  lastUpdated: number;
}

class PositionStore {
  private positions: Map<string, Position> = new Map();
  private ltpCache: Map<string, TickInfo> = new Map();
  private watchedTokens: Set<string> = new Set();
  private positionHasFreshTick: Map<string, boolean> = new Map();

  public getPositions(): Map<string, Position> {
    return this.positions;
  }

  public getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  public getLtpCache(): Map<string, number> {
    const map = new Map<string, number>();
    for (const [token, info] of this.ltpCache.entries()) {
      map.set(token, info.ltp);
    }
    return map;
  }

  public getLtpInfo(token: string): TickInfo | undefined {
    return this.ltpCache.get(token);
  }

  public getWatchedTokens(): Set<string> {
    return this.watchedTokens;
  }

  public updateTick(token: string, ltp: number, timestampMs: number = Date.now()): boolean {
    this.ltpCache.set(token, { ltp, lastUpdated: timestampMs });

    let updatedAnyPosition = false;
    for (const [posId, pos] of this.positions.entries()) {
      if (pos.status !== 'OPEN') continue;
      const matchesLeg = pos.legs.some((l) => l.status === 'OPEN' && l.token === token);
      if (matchesLeg) {
        this.positionHasFreshTick.set(posId, true);
        updatedAnyPosition = true;
      }
    }
    return updatedAnyPosition;
  }

  public hasFreshTickSinceLastCheck(positionId: string): boolean {
    return !!this.positionHasFreshTick.get(positionId);
  }

  public resetFreshTickFlag(positionId: string): void {
    this.positionHasFreshTick.set(positionId, false);
  }

  public setPosition(position: Position): void {
    this.positions.set(position.positionId, position);
    this.rebuildWatchedTokens();
  }

  public loadPositionsFromDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      return;
    }

    const files = fs.readdirSync(dirPath);
    const loadedIds = new Set<string>();

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(dirPath, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const json = JSON.parse(content);
          const result = PositionSchema.safeParse(json);

          if (!result.success) {
            notifyAlert(`[PositionStore] Invalid JSON schema in ${file}: ${result.error.message}`);
            continue;
          }

          const position = result.data;
          if (position.status === 'OPEN') {
            this.positions.set(position.positionId, position);
            loadedIds.add(position.positionId);
          } else {
            this.positions.delete(position.positionId);
          }
        } catch (err: any) {
          notifyAlert(`[PositionStore] Error loading position file ${file}: ${err.message}`);
        }
      }
    }

    for (const existingId of this.positions.keys()) {
      if (!loadedIds.has(existingId)) {
        this.positions.delete(existingId);
      }
    }

    this.rebuildWatchedTokens();
  }

  public updatePositionStatus(positionId: string, status: 'OPEN' | 'CLOSED'): void {
    const pos = this.positions.get(positionId);
    if (pos) {
      pos.status = status;
      if (status === 'CLOSED') {
        this.positions.delete(positionId);
      }
      this.rebuildWatchedTokens();
    }
  }

  private rebuildWatchedTokens(): void {
    this.watchedTokens.clear();
    for (const pos of this.positions.values()) {
      if (pos.status === 'OPEN') {
        for (const leg of pos.legs) {
          if (leg.status === 'OPEN') {
            this.watchedTokens.add(leg.token);
          }
        }
      }
    }
  }
}

export const positionStore = new PositionStore();
