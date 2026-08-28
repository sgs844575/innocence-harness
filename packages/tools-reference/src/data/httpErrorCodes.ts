/**
 * Reference entry: HTTP status semantics. Adapted from an upstream error
 * code reference into a platform-neutral English entry — generic class
 * semantics, per-code causes, and a retry policy keyed to retryability
 * rather than to any specific service.
 */
export const httpErrorCodesEntry = {
  id: "http-error-codes",
  title: "HTTP status semantics and retry policy",
  body: `# HTTP status semantics for clients

## Classes

- 1xx: protocol-level progress; a final response follows.
- 2xx: the request was accepted and processed as asked.
- 3xx: relocation or conditional outcomes — the resource moved permanently (301, 308), only via a temporary name (302, 307), or is unchanged since a cached visit (304).
- 4xx: the request itself is defective or unauthorized. Retrying the same payload unchanged normally fails again; fix the request, the credentials, or the expectation.
- 5xx: the serving side failed while handling a request that may itself be valid. Retrying is reasonable once the failure mode is understood.

## Client errors (4xx)

| Code | Meaning | Typical cause |
| --- | --- | --- |
| 400 | Malformed or invalid payload | Broken serialization, missing required fields, wrong types |
| 401 | Credentials absent or rejected | Missing, expired, or malformed token; challenge scheme mismatch |
| 403 | Credentials accepted but insufficient rights | Missing scope, suspended account, policy denial |
| 404 | Addressed resource does not exist | Typo in path or identifier, deleted object, wrong base URL |
| 405 | Method not supported at this address | Verb mismatch, such as writing to a read-only route |
| 408 | Request timed out server-side before completion | Slow upload, abandoned connection |
| 409 | State conflict | Concurrent update, duplicate creation, stale revision |
| 410 | Resource deliberately removed, no forwarding address | Neither retrying nor looking elsewhere will help |
| 413 | Payload exceeds what the endpoint accepts | Oversized body or upload |
| 415 | Unsupported representation format | Wrong or missing content type |
| 422 | Syntactically valid payload that fails semantic checks | Field values outside business rules |
| 428 | Precondition required | Missing concurrency guard header |
| 429 | Caller exceeded its quota in the window | Burst traffic, limits configured too low |
| 431 | Header block too large | Runaway cookies or oversized auth material |

## Server errors (5xx)

| Code | Meaning |
| --- | --- |
| 500 | Unhandled internal fault — a bug or a transient defect in the service |
| 501 | Capability not implemented by this deployment |
| 502 | An upstream partner returned an invalid response to the gateway |
| 503 | Service unavailable — overloaded or deliberately shed, frequently with guidance on when to return |
| 504 | Upstream partner did not answer within the bound |

## Retry policy

Retryable: 408 (the server invited a repeat), 429 (quota resets with time), and the 5xx group (500, 502, 503, 504) where the failure is environmental rather than a property of the payload. When the response carries a retry-after header, treat its value — delay in seconds or an absolute timestamp — as the earliest permitted attempt and never shortcut it. Absent guidance, back off exponentially with jitter and cap the attempts (four or five is a common budget).

Not retryable: 400, 401, 403, 404, 405, 409, 410, 413, 415, 422, 428 — the outcome derives from the request's content or authority, so retransmitting identical bytes reproduces the failure and burns quota. Correct the cause (payload shape, identifier, credential scope, precondition) or surface it to the caller.

Cross-cutting rules:

- Retry only requests whose side effects are idempotent or protected by an idempotency key; a retried charge or creation without one risks duplication.
- Refresh credentials once on the first 401 before concluding the token is dead; repeated 401s after a refresh indicate a real authorization problem.
- Branch on status codes or structured error fields, not on parsing human-readable message strings, which change without notice.
- Bound total retry time and surface the terminal status with the last error to the caller; silent unbounded retry loops mask outages.`,
} as const;
