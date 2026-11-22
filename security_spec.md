# Security Specification & Payload-First Verification

## 1. Data Invariants
1. Unauthenticated visitors and non-admin signed-in users can **never** read disabled albums (`enabled == false`) or disabled year cabinets via `get` or `list`.
2. Unauthenticated or non-admin users can **never** create, update, or delete any document in `archiveSettings`, `years`, `filmRolls`, `motionReels`, or `admins`.
3. Every admin write MUST verify `request.auth != null` AND verified admin identity (`exists(/databases/$(database)/documents/admins/$(request.auth.uid))` OR `request.auth.token.email == 'ihuxihui@gmail.com' && request.auth.token.email_verified == true`).
4. Every string field is strictly bounded via `.size()`; arrays (`frames` max 36, `keyframes` max 12) are strictly bounded; URLs stored on `videoUrl` reject `javascript:` or `data:` schemes; document IDs must match `^[a-zA-Z0-9_-]+$`.
5. `ownerUid` must equal `request.auth.uid` on creation and remain immutable on update; `createdAt` must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on both create and update.

## 2. Dirty Dozen Attack Payloads
1. Unauthenticated `update` on `/filmRolls/2026-roll-01` flipping `enabled: true` -> `PERMISSION_DENIED`.
2. Non-admin authenticated `create` on `/admins/attackerUid` with `{ role: 'admin' }` -> `PERMISSION_DENIED`.
3. Email spoofing write where `request.auth.token.email == 'ihuxihui@gmail.com'` but `email_verified == false` -> `PERMISSION_DENIED`.
4. Unauthenticated `list` on `/filmRolls` without `where('enabled', '==', true)` when disabled docs exist -> `PERMISSION_DENIED`.
5. Unauthenticated `get` on disabled `/filmRolls/private-roll` (`enabled: false`) -> `PERMISSION_DENIED`.
6. Ghost field ("Shadow Update") payload adding `extraSecret: 'bypass'` on `/filmRolls` create/update -> `PERMISSION_DENIED`.
7. Oversized ID poisoning (`1500` chars) on `/filmRolls/{rollId}` -> `PERMISSION_DENIED`.
8. Oversized array (`40` items in `frames`, exceeding `36` limit) -> `PERMISSION_DENIED`.
9. Client-forged `createdAt` timestamp not equal to `request.time` -> `PERMISSION_DENIED`.
10. Modifying immutable `createdAt` or `ownerUid` during `update` -> `PERMISSION_DENIED`.
11. `javascript:alert(1)` injected into `motionReels.videoUrl` -> `PERMISSION_DENIED`.
12. `title` exceeding `120` chars or wrong primitive type (`enabled: "yes"`) -> `PERMISSION_DENIED`.
