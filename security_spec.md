# Security Specification & Payload-First TDD (`security_spec.md`)

## 1. Data Invariants
1. **Default-Deny Baseline**: Every path under `/databases/{database}/documents` is denied unless explicitly matched and verified.
2. **Verified Authentication**: Every read/write on multiplayer rooms, players, and chat messages requires a valid Firebase Auth user with `request.auth.token.email_verified == true`.
3. **Zero PII Exposure**: Player documents store only a short chosen display nickname (`1..18` chars), color index (`0..7`), and 3D coordinates/animation flags. Email addresses and private account details are never written to Firestore.
4. **Master Gate Parent Integrity**: Every `/rooms/{roomId}/players/{playerId}`, `/rooms/{roomId}/messages/{messageId}`, `/rooms/{roomId}/worlds/{mapId}`, and `/rooms/{roomId}/hits/{hitId}` write verifies the parent `/rooms/{roomId}` document exists (`exists(...)`) and binds `data.roomId == roomId` and document ID matches (`data.id == docId`).
5. **Ownership & Anti-Spoofing**: Every `RoomPlayer`, `RoomMessage`, and `RoomEnemyHit` sets `ownerUid == request.auth.uid` on create and forbids changing `ownerUid`, `roomId`, or `id` on update. `RoomWorld` enforces `updatedByUid == request.auth.uid`, immutable `id`/`roomId`/`mapId`/`createdAt`, bounded `enemies` array (`size() <= 24`), and action-scoped `affectedKeys().hasOnly(...)` updates.
6. **Temporal Integrity**: `createdAt` and `updatedAt` are strictly validated against `request.time` (`serverTimestamp()`), and `createdAt` is immutable on update.
7. **Strict Boundaries & No Ghost Fields**: Every entity enforces `keys().hasAll(...) && keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update, string `.size()` limits, enum checks for `mapId` / `weatherMode`, and numeric range bounds.
8. **No Collection Scraping**: `/rooms` forbids `list` queries so users can only `get` a specific known `{roomId}`. Subcollections `/players`, `/messages`, `/worlds`, and `/hits` enforce `resource.data.roomId == roomId` on `list` queries without `get()` calls inside list rules.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: Create `/rooms/global/players/p1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Create `/rooms/global/players/p1` with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Create**: Create player with `ownerUid: "victim_uid"` while signed in as `"attacker_uid"` -> `PERMISSION_DENIED`.
4. **Cross-Owner Update Hijack**: Update another player's `/rooms/global/players/victim_session` -> `PERMISSION_DENIED`.
5. **Cross-Owner Delete**: Delete another player's `/rooms/global/players/victim_session` -> `PERMISSION_DENIED`.
6. **Ghost Field / Shadow Update**: Update player with extra `{ isAdmin: true }` or create with `{ role: "admin" }` -> `PERMISSION_DENIED`.
7. **Invalid Map Enum**: Write `mapId: "../../etc/passwd"` or `"unknown_map"` -> `PERMISSION_DENIED`.
8. **Resource Exhaustion / 1MB String**: Write `text` with 5000 chars or `name` with 200 chars -> `PERMISSION_DENIED`.
9. **Path ID Poisoning**: Target `/rooms/invalid room!id/players/p1` or 200-char `{playerId}` -> `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: Send `updatedAt: Timestamp.fromMillis(Date.now() + 99999999)` instead of `serverTimestamp()` -> `PERMISSION_DENIED`.
11. **Room Scraping (`list` on `/rooms`)**: Execute `getDocs(collection(db, 'rooms'))` -> `PERMISSION_DENIED`.
12. **Orphan Subcollection Write**: Create `/rooms/nonexistent_room/messages/m1` when `/rooms/nonexistent_room` does not exist -> `PERMISSION_DENIED`.
