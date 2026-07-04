# Security Specification - Database Fortress & Red Team Audit

This document outlines the security specifications, data invariants, and adversarial "Dirty Dozen" payloads designed to test the resilience of the Firestore database security layer for the **Artchie Forex Simulator App**.

---

## 1. Data Invariants

Our Firestore database is structured around the `users` collection where each document key is the user's lowercased email address (e.g., `users/achavezsalva@gmail.com`). 

| Entity | Field | Type | Rules & Invariants |
| :--- | :--- | :--- | :--- |
| **User** | `email` | `string` | **Immutable & Consistent**: Must match the authenticated user's email, the document ID, and `request.auth.token.email`. |
| **User** | `role` | `string` | **Immutable & Secure**: Can only be `'user'` or `'admin'`. Non-admin accounts can never escalate themselves to `'admin'`. Bootstrapped admin is restricted to `achavezsalva@gmail.com`. |
| **User** | `createdAt` | `string` | **Immutable**: Set upon creation, cannot be modified or updated. |
| **User** | `balance` | `number` | **Validated**: Must be a positive numeric value representing the virtual balance. |

---

## 2. The "Dirty Dozen" Malicious Payloads

The following 12 payloads represent adversarial attempts to compromise the integrity, privacy, or authorization boundaries of the Firestore database.

### Pillar 1: Identity & Authorization Attacks
1. **Unauthenticated Read Attack (PII Leak)**
   - *Description*: An anonymous user attempts to read `/users/achavezsalva@gmail.com` without being logged in.
   - *Expected*: `PERMISSION_DENIED`
2. **Cross-Tenant Hijack (Identity Spoofing)**
   - *Description*: User `attacker@gmail.com` attempts to read `/users/victim@gmail.com`.
   - *Expected*: `PERMISSION_DENIED`
3. **Foreign Document Creation**
   - *Description*: User `attacker@gmail.com` attempts to create a profile under `/users/victim@gmail.com`.
   - *Expected*: `PERMISSION_DENIED`

### Pillar 2: Privilege Escalation & Role Attacks
4. **Admin Role Self-Assignment (Creation)**
   - *Description*: User `hacker@gmail.com` attempts to register with `role: "admin"`.
   - *Expected*: `PERMISSION_DENIED` (only `achavezsalva@gmail.com` can have `'admin'` role upon creation).
5. **Privilege Escalation (Update)**
   - *Description*: User `hacker@gmail.com` (currently with `'user'` role) attempts to update their own document to `role: "admin"`.
   - *Expected*: `PERMISSION_DENIED` (role field is immutable).

### Pillar 3: Schema & Data Integrity Attacks
6. **Shadow Fields Injection (Ghost Field)**
   - *Description*: A user attempts to add unapproved attributes (e.g., `isVerified: true`, `bypassLimits: true`) during profile creation or update.
   - *Expected*: `PERMISSION_DENIED` (strict schema validation blocks undefined fields).
7. **Type Poisoning (Balance Field)**
   - *Description*: An attacker attempts to set `balance: "one million"` (string injection into a numeric field).
   - *Expected*: `PERMISSION_DENIED` (balance must be a number).
8. **Value Poisoning (Corrupted Role)**
   - *Description*: A user attempts to set `role: "super-user"` (unrecognized role value).
   - *Expected*: `PERMISSION_DENIED` (role must be strictly `'user'` or `'admin'`).

### Pillar 4: Consistency & Lifecycle Attacks
9. **Email Discrepancy (Integrity Tampering)**
   - *Description*: Attacker `attacker@gmail.com` attempts to create/update `/users/attacker@gmail.com` but sets the payload field `email: "victim@gmail.com"`.
   - *Expected*: `PERMISSION_DENIED` (email field must match the document ID).
10. **CreatedAt Tampering (Immutability Violation)**
    - *Description*: An authenticated user attempts to modify their `createdAt` timestamp to backdate their account.
    - *Expected*: `PERMISSION_DENIED` (createdAt is immutable after creation).
11. **Bulk Scrape / List Query Attack**
    - *Description*: A user attempts to run a query to fetch the entire `/users` collection list (blanket read/scrape).
    - *Expected*: `PERMISSION_DENIED` (list operations are blocked, queries must filter by the user's specific email address).
12. **Malicious Account Deletion (Denial of Service)**
    - *Description*: A user tries to delete their `/users/{email}` document to wipe out transaction traces.
    - *Expected*: `PERMISSION_DENIED` (deletion of user profiles is strictly disallowed).

---

## 3. Test Runner Spec

A test suite verifying these rules can be found in `firestore.rules.test.ts`. This ensures mathematically sound execution of Zero-Trust security rules on the live Firestore instance.
