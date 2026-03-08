# Debug Session Record

- Status: OPEN
- Symptom: certificate issue job failed with `acme.createPrivateKey is not a function`
- Scope: `/api/v1/certificates` create-and-issue async flow
- Started At: 2026-03-07

## Hypotheses

1. `acme-client` v5 API no longer exposes `createPrivateKey` at module root.
2. `createClient` helper is not available on current `acme-client` export.
3. ESM/CJS import style causes exported members to be nested under `default`.
4. Runtime is using a different acme-client version than expected by source code.

## Evidence Plan

- Inspect installed `acme-client` runtime exports from local `node_modules`.
- Compare used methods in `cert.service.ts` with actual API surface.
- Apply minimal compatibility fix for the concrete export shape in runtime.
- Re-run TypeScript build and trigger one certificate issue to verify.
