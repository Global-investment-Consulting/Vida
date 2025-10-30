#!/usr/bin/env node
/**
 * Verifies the active Node.js toolchain matches the repository requirements.
 * - Node must match the .nvmrc major version and not be older than the pinned patch.
 * - npm must be available with a major version compatible with Node 20 (>=10).
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const exit = (message) => {
  console.error(`[verify-node] ${message}`);
  process.exitCode = 1;
};

const parseSemver = (value) => {
  return value
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
};

const compareSemver = (actual, expected) => {
  const length = Math.max(actual.length, expected.length);
  for (let i = 0; i < length; i += 1) {
    const a = actual[i] ?? 0;
    const e = expected[i] ?? 0;
    if (a > e) return 1;
    if (a < e) return -1;
  }
  return 0;
};

const verifyNodeVersion = async () => {
  const nvmrcPath = resolve(repoRoot, '.nvmrc');
  const expectedRaw = (await readFile(nvmrcPath, 'utf8')).trim();
  if (!expectedRaw) {
    exit(`.nvmrc is empty -- expected a Node version`);
    return false;
  }

  const expected = parseSemver(expectedRaw);
  const actual = parseSemver(process.version);

  if (actual[0] !== expected[0]) {
    exit(
      `Node major version mismatch. Expected ${expectedRaw}, but found ${process.version}`,
    );
    return false;
  }

  if (compareSemver(actual, expected) < 0) {
    exit(
      `Node version ${process.version} is older than required ${expectedRaw}. Please upgrade.`,
    );
    return false;
  }

  return true;
};

const verifyNpm = () => {
  const result = spawnSync('npm', ['--version'], {
    encoding: 'utf8',
  });

  if (result.error) {
    exit(`npm CLI not detected in PATH (Node 20 bundles npm 10+).`);
    return false;
  }

  const npmVersion = result.stdout.trim();
  const [major] = parseSemver(npmVersion);
  if (Number.isNaN(major) || major < 10) {
    exit(`npm version ${npmVersion} is incompatible. Expected npm >= 10.`);
    return false;
  }

  return npmVersion;
};

const main = async () => {
  const nodeOk = await verifyNodeVersion();
  const npmVersion = nodeOk ? verifyNpm() : false;

  if (nodeOk && npmVersion) {
    console.log(`[verify-node] Node ${process.version} with npm ${npmVersion} meets requirements.`);
  } else {
    process.exit(1);
  }
};

main().catch((error) => {
  exit(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
