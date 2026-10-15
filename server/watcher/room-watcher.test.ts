import { describe, expect, it, vi } from 'vitest';
import { RoomWatcherManager, MAX_LOG_LINES } from './room-watcher';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RoomWatcherManager', () => {
  it('detecta se scripts/pipeline-watcher.sh existe na pasta', () => {
    const mgr = new RoomWatcherManager();
    const testDir = join(tmpdir(), `habblaud-watcher-test-${Date.now()}`);
    mkdirSync(join(testDir, 'scripts'), { recursive: true });

    expect(mgr.hasWatcherScript(testDir)).toBe(false);

    writeFileSync(join(testDir, 'scripts', 'pipeline-watcher.sh'), '#!/bin/bash\necho "test"');
    expect(mgr.hasWatcherScript(testDir)).toBe(true);

    rmSync(testDir, { recursive: true, force: true });
  });

  it('retorna status available=false quando a pasta não tem o script', () => {
    const mgr = new RoomWatcherManager();
    const status = mgr.getStatus('room-1', '/caminho/inexistente/12345');
    expect(status.available).toBe(false);
    expect(status.running).toBe(false);
  });

  it('inicia e interrompe um processo fake', async () => {
    const mgr = new RoomWatcherManager();
    const testDir = join(tmpdir(), `habblaud-watcher-run-${Date.now()}`);
    mkdirSync(join(testDir, 'scripts'), { recursive: true });

    // Script que roda por um tempo
    writeFileSync(
      join(testDir, 'scripts', 'pipeline-watcher.sh'),
      '#!/bin/bash\necho "Iniciando..."\nsleep 5\necho "Fim"\n',
    );

    const startRes = mgr.start('room-test', testDir);
    expect(startRes.ok).toBe(true);
    expect(startRes.status.running).toBe(true);
    expect(startRes.status.pid).toBeTypeOf('number');

    // Status deve ser running
    const status = mgr.getStatus('room-test');
    expect(status.running).toBe(true);

    // Stop deve interromper
    const stopRes = mgr.stop('room-test');
    expect(stopRes.ok).toBe(true);

    mgr.shutdown();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('gerencia logs e buffer', () => {
    const mgr = new RoomWatcherManager();
    mgr.clearLogs('room-1');
    expect(mgr.getLogs('room-1')).toBe('');
  });
});
