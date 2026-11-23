import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');

// The pattern exactly as worktree.sh builds it, appended lines included.
const disposable = execFileSync(
  'bash',
  ['-c', 'eval "$(grep -E "^DISPOSABLE\\+?=" scripts/worktree.sh)"; printf %s "$DISPOSABLE"'],
  { cwd: root, encoding: 'utf8' },
);

// The ignored paths remove_worktree would refuse, read the way it reads them.
function unexpectedIgnored(files: string[]): string[] {
  const repo = mkdtempSync(join(tmpdir(), 'throw-worktree-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    for (const ignore of [
      '.gitignore',
      'apps/web/android/.gitignore',
      'apps/web/android/app/.gitignore',
    ]) {
      mkdirSync(dirname(join(repo, ignore)), { recursive: true });
      copyFileSync(join(root, ignore), join(repo, ignore));
    }
    for (const file of files) {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), '');
    }
    const status = execFileSync(
      'git',
      [
        '-c',
        'core.quotePath=false',
        'status',
        '--porcelain',
        '--ignored',
        '--untracked-files=all',
        '-z',
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    const ignored = status
      .split('\0')
      .filter((line) => line.startsWith('!! '))
      .map((line) => line.slice(3));
    const pattern = new RegExp(`^\\.env\\.worktree$|${disposable}`);
    return ignored.filter((path) => !pattern.test(path));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test('Gradle and cap sync output does not block removing a worktree', () => {
  assert.deepEqual(
    unexpectedIgnored([
      'apps/web/android/.gradle/8.14/checksums/checksums.lock',
      'apps/web/android/build/reports/problems/problems-report.html',
      'apps/web/android/app/build/outputs/apk/dev/debug/app-dev-debug.apk',
      'apps/web/android/app/src/main/assets/public/index.html',
      'apps/web/android/app/src/main/assets/capacitor.config.json',
      'apps/web/android/app/src/main/assets/capacitor.plugins.json',
      'apps/web/android/app/src/main/res/xml/config.xml',
      'apps/web/android/capacitor-cordova-android-plugins/build.gradle',
      'apps/web/node_modules/react/index.js',
      'apps/web/dist/index.html',
      '.env.worktree',
    ]),
    [],
  );
});

test('local Android config and signing keys still block removing a worktree', () => {
  const protectedFiles = [
    'apps/web/android/local.properties',
    'apps/web/android/release.keystore',
    'apps/web/android/app/upload.jks',
    'apps/web/android/.idea/workspace.xml',
  ];
  assert.deepEqual(unexpectedIgnored(protectedFiles).sort(), protectedFiles.sort());
});
