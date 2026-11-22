import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DriveLabState, validateLabState, LAB_STATE_FILE, LAB_CLAIM_FILE, LAB_LOCK_FILE } from './drive-lab-state.mjs';
import { requireDrive, assertQuietRuntime, validateExternalPath, assertPrivatePermissions,
  readPrivateJson } from './drive-token-store.mjs';

const FILES = [LAB_STATE_FILE, LAB_CLAIM_FILE].sort();
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stamp = stat => {
  // atime is deliberately excluded: an ordinary read can update it without changing content.
  const keys = ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs'];
  requireDrive(keys.every(key => Number.isFinite(stat[key])), 'LAB_DIAGNOSE_UNVERIFIED_METADATA');
  return Object.fromEntries(keys.map(key => [key, stat[key]]));
};

function unknownReport(phase, failed = false) {
  return { integrityValid: failed ? false : 'UNKNOWN', phase, createAttempted: 'UNKNOWN',
    rootReferencePresent: 'UNKNOWN', folderReferencePresent: 'UNKNOWN', claimMatchesJournal: 'UNKNOWN',
    approvalConsumed: 'UNKNOWN', stateStable: failed ? false : 'UNKNOWN', remoteCreationProven: 'UNKNOWN' };
}

export function parseDiagnoseArguments(args) {
  requireDrive(Array.isArray(args) && args.length <= 1 && args.every(arg => ['--dry-run', '--execute'].includes(arg)),
    'LAB_DIAGNOSE_ARGUMENTS_REJECTED');
  return { execute: args[0] === '--execute' };
}

// Only path metadata and the two fixed state files. No writer, lock acquisition or OAuth session.
export class LabDiagnosticReader {
  constructor(directory) { this.directory = directory; this.state = new DriveLabState(directory); }
  async snapshot() {
    const directory = await validateExternalPath(this.directory, { directory: true });
    await assertPrivatePermissions(directory.filename);
    const names = (await fs.readdir(directory.filename)).sort();
    requireDrive(!names.includes(LAB_LOCK_FILE), 'LAB_DIAGNOSE_CONCURRENT_OPERATION');
    requireDrive(same(names, FILES), 'LAB_DIAGNOSE_INCOMPLETE_DIRECTORY');
    const files = [];
    for (const name of FILES) {
      const entry = await validateExternalPath(path.join(directory.filename, name));
      await assertPrivatePermissions(entry.filename);
      files.push(stamp(entry.stat));
    }
    const after = await validateExternalPath(this.directory, { directory: true });
    const finalNames = (await fs.readdir(after.filename)).sort();
    requireDrive(!finalNames.includes(LAB_LOCK_FILE), 'LAB_DIAGNOSE_CONCURRENT_OPERATION');
    requireDrive(same(names, finalNames) && same(stamp(directory.stat), stamp(after.stat)), 'LAB_DIAGNOSE_STATE_CHANGED');
    return { directory: stamp(after.stat), files };
  }
  async read() {
    return { state: await this.state.read(path.join(this.directory, LAB_STATE_FILE)),
      claim: await readPrivateJson(path.join(this.directory, LAB_CLAIM_FILE)) };
  }
}

function validatePair({ state, claim }) {
  // State schema and envelope checksum were checked by the existing DriveLabState.read().
  validateLabState(state);
  const creation = state.creation;
  requireDrive(creation !== null && state.usedApprovals.length > 0, 'LAB_DIAGNOSE_INCOMPLETE_STATE');
  requireDrive(exactKeys(claim, ['kind', 'operationId', 'clientBinding', 'ownerPermissionId']) &&
    claim.kind === 'LEVEL_XVIII_LAB_CREATE_CONSUMED_V1' &&
    ['operationId', 'clientBinding', 'ownerPermissionId'].every(key => claim[key] === creation[key]),
  'LAB_DIAGNOSE_CLAIM_MISMATCH');
  // Reject combinations that the unchanged creation engine cannot normally persist.
  const beforeCreate = ['RESERVED', 'BLOCKED'].includes(creation.phase);
  requireDrive(beforeCreate ? !creation.createAttempted && creation.rootId === null && creation.folderId === null &&
    state.usedApprovals.length === 1 : creation.createAttempted && creation.rootId !== null,
  'LAB_DIAGNOSE_AMBIGUOUS_STATE');
  return creation;
}

export async function runDiagnoseCommand({ execute = false, env = process.env } = {}, injected = {}) {
  requireDrive(typeof execute === 'boolean', 'LAB_DIAGNOSE_ARGUMENTS_REJECTED');
  // Return before reading even configuration, filesystem metadata, private ACLs or injected dependencies.
  if (!execute) return unknownReport('DRY_RUN');
  assertQuietRuntime(env);
  requireDrive(env.LEVEL_DRIVE_LAB_DIAGNOSE_QUIESCENT === 'true', 'LAB_DIAGNOSE_QUIESCENCE_REQUIRED');
  const reader = (injected.makeReader ?? (directory => new LabDiagnosticReader(directory)))(env.LEVEL_DRIVE_LAB_STATE_DIR);
  const before = await reader.snapshot();
  const first = await reader.read(); validatePair(first);
  const middle = await reader.snapshot();
  requireDrive(same(before, middle), 'LAB_DIAGNOSE_STATE_CHANGED');
  const second = await reader.read(); const creation = validatePair(second);
  const after = await reader.snapshot();
  requireDrive(same(before, after) && same(first, second), 'LAB_DIAGNOSE_STATE_CHANGED');
  return { integrityValid: true, phase: creation.phase, createAttempted: creation.createAttempted,
    rootReferencePresent: creation.rootId !== null, folderReferencePresent: creation.folderId !== null,
    claimMatchesJournal: true, approvalConsumed: true, stateStable: true,
    // Historical local evidence only. An UNCERTAIN receipt does not prove completed inspection.
    remoteCreationProven: creation.phase === 'CREATED' ? true : creation.createAttempted ? 'UNKNOWN' : false };
}

export async function main(args = process.argv.slice(2), env = process.env, output = console, injected = {}) {
  try {
    const result = await runDiagnoseCommand({ ...parseDiagnoseArguments(args), env }, injected);
    output.log(JSON.stringify(result)); return 0;
  } catch {
    // Never echo an exception, its code, a filename or partially validated private fields.
    output.error(JSON.stringify(unknownReport('UNKNOWN', true))); return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
