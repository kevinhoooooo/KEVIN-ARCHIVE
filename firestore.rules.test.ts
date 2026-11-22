/**
 * Security rules verification checklist for KEVIN ARCHIVE Firestore Rules.
 * Covers all Dirty Dozen attack payloads documented in security_spec.md.
 */
export interface RulesTestCase {
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'ALLOW' | 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: RulesTestCase[] = [
  {
    name: 'Reject unauthenticated update to filmRolls',
    collection: 'filmRolls/2026-roll-01',
    operation: 'update',
    auth: null,
    payload: { enabled: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject non-admin self-escalation to admins collection',
    collection: 'admins/attacker',
    operation: 'create',
    auth: { uid: 'attacker', email: 'attacker@example.com', email_verified: true },
    payload: { email: 'attacker@example.com', role: 'admin', createdAt: 'SERVER_TIME' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject unverified email spoofing admin email',
    collection: 'filmRolls/roll-1',
    operation: 'update',
    auth: { uid: 'spoof', email: 'ihuxihui@gmail.com', email_verified: false },
    payload: { title: 'Hacked' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject unfiltered list query on filmRolls by public visitor',
    collection: 'filmRolls',
    operation: 'list',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject public get on disabled filmRoll',
    collection: 'filmRolls/disabled-roll',
    operation: 'get',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject shadow ghost field on create',
    collection: 'years/2027',
    operation: 'create',
    auth: { uid: 'admin-uid', email: 'ihuxihui@gmail.com', email_verified: true },
    payload: { year: '2027', extraField: 'ghost' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject oversized document ID (> 128 chars)',
    collection: `filmRolls/${'a'.repeat(200)}`,
    operation: 'create',
    auth: { uid: 'admin-uid', email: 'ihuxihui@gmail.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject frames array exceeding 36 frames',
    collection: 'filmRolls/roll-overflow',
    operation: 'update',
    auth: { uid: 'admin-uid', email: 'ihuxihui@gmail.com', email_verified: true },
    payload: { frames: new Array(37).fill({}) },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject forged client createdAt timestamp',
    collection: 'years/2027',
    operation: 'create',
    auth: { uid: 'admin-uid', email: 'ihuxihui@gmail.com', email_verified: true },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject modifying immutable ownerUid on update',
    collection: 'filmRolls/2026-roll-01',
    operation: 'update',
    auth: { uid: 'admin-uid', email: 'ihuxihui@gmail.com', email_verified: true },
    payload: { ownerUid: 'someone-else' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject javascript: scheme in videoUrl',
    collection: 'motionReels/2026-motion-01',
    operation: 'update',
    auth: { uid: 'admin-uid', email: 'ihuxihui@gmail.com', email_verified: true },
    payload: { videoUrl: 'javascript:alert(1)' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: 'Reject invalid enabled string type on filmRolls update',
    collection: 'filmRolls/2026-roll-01',
    operation: 'update',
    auth: { uid: 'admin-uid', email: 'ihuxihui@gmail.com', email_verified: true },
    payload: { enabled: 'yes' },
    expected: 'PERMISSION_DENIED',
  },
];
