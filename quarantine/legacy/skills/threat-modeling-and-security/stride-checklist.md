# STRIDE Security Review Checklist & Code Patterns

Use this reference during design and code reviews to audit services against the STRIDE threat model.

---

## 1. Spoofing (Identity & Authenticity)

**Risks:** Forged authentication tokens, missing signature verification on webhooks.

### Verification Checklist:
- [ ] JWT tokens verify signature algorithm explicitly (`algorithms: ['RS256']`) — never allow `none` algorithm.
- [ ] Webhook handlers verify cryptographic HMAC signatures before parsing request body.
- [ ] Passwords stored with Argon2id or bcrypt (cost factor $\ge 12$).

```typescript
// GOOD: Cryptographic timing-safe webhook signature verification
import crypto from 'crypto';

export function verifyWebhookSignature(payload: Buffer, signature: string, secret: string): boolean {
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  
  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}
```

---

## 2. Tampering (Data Integrity)

**Risks:** Parameter tampering, mass assignment, unvalidated payload modification.

### Verification Checklist:
- [ ] Incoming request bodies parsed through strict Zod/Pydantic schemas with `strip` or `strict` mode (disallow unwhitelisted fields).
- [ ] Database updates restrict modified columns explicitly (never `UPDATE users SET ...req.body`).

```typescript
// GOOD: Strict schema whitelist preventing mass assignment
import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).trim(),
  avatarUrl: z.string().url().optional(),
}).strict(); // Rejects extra unexpected fields like 'isAdmin'
```

---

## 3. Repudiation (Audit & Traceability)

**Risks:** Actions performed without persistent audit logs or timestamps.

### Verification Checklist:
- [ ] Critical operations (financial transfers, permission changes, user deletions) write immutable audit logs with `actor_id`, `action`, `target_id`, `timestamp_utc`, and `ip_hash`.
- [ ] Log messages redact sensitive tokens and credentials before writing to disk.

---

## 4. Information Disclosure (Confidentiality)

**Risks:** IDOR, stack trace leakage in API responses, secrets in git.

### Verification Checklist:
- [ ] Database queries scope to `tenant_id` / `owner_id` (Insecure Direct Object Reference prevention).
- [ ] Production error handlers return generic error messages to clients; stack traces logged only internally.
- [ ] CORS configuration explicitly lists allowed origins (no wildcard `Access-Control-Allow-Origin: *` with credentials).

```typescript
// GOOD: Tenant-scoped entity retrieval
export async function getDocumentById(tenantId: string, docId: string, userId: string) {
  const doc = await db.documents.findFirst({
    where: {
      id: docId,
      tenantId: tenantId, // Strict boundary
    }
  });
  if (!doc) throw new NotFoundError('Document not found');
  return doc;
}
```

---

## 5. Denial of Service (Availability)

**Risks:** Unbounded memory allocation, ReDoS regexes, unpaginated DB queries.

### Verification Checklist:
- [ ] API endpoints enforce rate limiting (e.g. token bucket / Redis rate limiter).
- [ ] List queries enforce max pagination limits (`limit = Math.min(requestedLimit, 100)`).
- [ ] Regex patterns checked for polynomial backtracking (ReDoS).

---

## 6. Elevation of Privilege (Access Control)

**Risks:** Missing role/permission checks on internal API endpoints.

### Verification Checklist:
- [ ] All mutation routes protected by authorization middleware.
- [ ] Role hierarchies checked centrally, not scattered across ad-hoc conditionals.
