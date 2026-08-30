---
name: threat-modeling-and-security
description: Use when designing or implementing authentication, authorization, APIs, payment flows, file uploads, or handling sensitive user data - before writing production code or merging changes
---

# Threat Modeling and Security

## Overview

Security is an architectural invariant, not an afterthought bolted on after development. Evaluate trust boundaries, model threats (STRIDE), and isolate sensitive data before writing code.

**Core principle:** Assume all external input is hostile, assume the network is tapped, and minimize blast radius.

**The Iron Law:**
```
NO PRODUCTION ENDPOINT OR DATA MUTATION WITHOUT EXPLICIT AUTHORIZATION AND INPUT VALIDATION
```

## When to Use

**Always use when:**
- Implementing authentication (Authn) or authorization (Authz) logic
- Creating public or internal API endpoints and webhook receivers
- Handling sensitive data (PII, passwords, payment tokens, API keys)
- Processing user-supplied file uploads, XML, or unstructured payloads
- Executing system shell commands or evaluating dynamic scripts
- Modifying security-sensitive configuration (CORS, CSP, TLS settings)

**Don't use when:**
- Working on pure local static assets or formatting documentation (unless it includes credentials)

## The STRIDE Threat Model

Before writing code for an endpoint or service, evaluate these 6 threat categories:

| Threat | Definition | Primary Defense |
|---|---|---|
| **S**poofing | Impersonating an entity or user | Cryptographic authentication, signed tokens, mTLS |
| **T**ampering | Modifying data in-flight or in-storage | Strict input validation, checksums, HMAC verification |
| **R**epudiation | Denying an action took place | Tamper-evident audit logging with timestamps |
| **I**nformation Disclosure | Exposing data to unauthorized parties | Encryption at rest/transit, field-level redaction, CORS restriction |
| **D**enial of Service | Exhausting resources to degrade availability | Rate limiting, request size limits, query pagination, timeouts |
| **E**levation of Privilege | Gaining unpermitted capabilities | Strict role-based/capability-based access control (RBAC/CBAC) |

## Security Implementation Checklist

### 1. Input Boundary Validation
- Validate all incoming payloads against a strict schema (e.g. Zod, JSON Schema, Pydantic) at the outermost seam.
- Whitelist allowed properties; never blindly forward raw objects to database queries or shell commands.
- Sanitize and escape any data rendered in HTML or shell contexts (prevent XSS / Command Injection).

### 2. Authorization & Tenant Isolation
- Verify authorization on *every single request* based on the authenticated subject.
- Prevent Insecure Direct Object References (IDOR): never query `findById(id)` without scoping to the tenant/user: `findByTenantAndId(tenantId, id)`.
- Use constant-time comparison (`crypto.timingSafeEqual`) for HMACs and secret tokens to prevent timing attacks.

### 3. Secrets Hygiene
- Never hardcode secrets, API keys, private keys, or credentials in source code or test fixtures.
- Use environment variables or secret vaults.
- Redact secrets from logs, error messages, and exception stack traces.

### 4. Concurrency & Race Conditions
- Use database transactions with appropriate isolation levels (e.g. `SERIALIZABLE` or pessimistic locking) for balance deductions or inventory reservation.
- Ensure idempotent operations for webhook handlers and payment retries (use idempotency keys).

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "This is an internal API, no need for auth" | Internal networks get breached. Zero-trust architecture requires auth everywhere. |
| "Client-side validation is sufficient" | Attackers bypass client code with curl/Postman. Server-side validation is mandatory. |
| "A quick test token in git won't hurt" | Commits are permanent in git history. Use environment mock variables. |
| "We'll add rate limiting later" | Unprotected endpoints get DoS'd on day one. Add limits at the seam now. |

## Red Flags

- `eval()`, `dangerouslySetInnerHTML`, or unescaped string interpolation in SQL/shell commands
- Missing `@Authorized` / middleware checks on newly created routes
- Exposing database auto-incrementing IDs directly without ownership checks
- Catch-all exception handlers printing raw environment variables
