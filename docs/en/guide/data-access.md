# Data-Access Half

Migrated from the mcp-foundry guard pipeline; lives in `@yiong/railguard/data`. Three disciplines run through everything:
**fail-closed** (missing identity/role/rule → reject, always), **no existence-enumeration oracle**
("not found" and "no access" reject in identical shape), and **no replay** (approvals: one ticket, one use).

## RBAC Configuration Model

The host passes a structured object (YAML parsing is the host's job); `validateRbacConfig` does zero-dependency structural validation —
config errors must blow up at startup, not surface at request time.

```ts
const config: RbacConfig = {
  roles: {
    admin: { tools: '*', approver: true },
    support: {
      tools: ['list_orders', 'get_customer', 'refund'],
      rows: [{ field: 'assignee', equals: '$self.id' }],   // row-level: only rows assigned to you
      mask: ['id_card', 'salary'],                          // field masking
      approval: [{ tool: 'refund', when: { field: 'amount', gt: 1000 } }], // tiered approval
    },
  },
}
```

- `$self.id` / `$self.attrs.<key>` reference the requester. **Deliberately not an expression DSL** —
  an evaluatable string is an injection surface; a structured object is not.
- Multiple hats: `principal.attrs['role:<system>']` overrides the role per target system, falling back to `role` by default.
- Approval conditions with a missing or non-numeric value always evaluate to true — fail-safe: "leave the amount blank" does not bypass tiering.

## rbacToolGate (beforeToolCall)

Role → tool allowlist. Unknown role or no identity → blocked, always (fail-closed, `failMode: 'closed'`).
The companion `allowedTools()` narrows at the tools/list stage: tools you shouldn't use never appear in the list at all,
rather than getting blocked only after the model calls them.

## rowFilter (afterToolCall)

Row-level filtering: arrays are filtered row by row; a single object that doesn't match is rejected outright. Two hard semantics:

- **"Not found" and "no access" return the same rejection** — any difference becomes an existence-enumeration oracle
  (attackers probe error wording to learn whether data exists);
- A rule field that's missing, or a `$self` that fails to resolve, counts as no-match — better to wrongly reject than wrongly release.

When no row was filtered, return `pass` instead of `modified` (since 1.1.0) — verdict semantics must be honest;
benign cases in evals shouldn't show up as "modified".

## fieldMask (afterToolCall)

Recursively erases fields by role (including nested objects and arrays). Reports `pass` when the data contains no target field (since 1.1.0).

## approvalGate (beforeToolCall)

Tiered human approval, event-sourced storage:

```
call requiring approval → idempotent ticket creation (escalated, with ticket id + original call)
        → approver decides
        → same principal, same args retries → consumes the ticket to release (approved) or block (denied)
```

- **Idempotent ticket creation**: repeated calls don't open duplicate tickets; **one ticket, one use**: a decided ticket is void after consumption — no replay;
- The **retry-consumes-ticket** recovery semantics fit stateless HTTP naturally — no suspended long-lived connection needed;
- The tiering condition's evaluation context = call args + host-injected `signals` (e.g. "how many refunds this month");
- Requires approval but no store wired = fail-closed.

Stores: `MemoryApprovalStore` (in-memory, for evals/tests) and `JsonlApprovalStore`
(`@yiong/railguard/node`, write-ahead log + torn-write-tolerant replay). Tickets store the args verbatim
(the approver must see exactly what they're approving); treat the persisted file as confidential, same as the audit log.

## Converging with the Rules Half

Both halves share one pipeline and one context — RBAC blocks and injection detections land in the same audit stream:

```ts
const guard = createGuard({
  hooks: {
    beforeToolCall: [rbacToolGate({ config }), approvalGate({ config, store }), lethalTrifecta({ ... })],
    afterToolCall: [rowFilter({ config }), fieldMask({ config })],
  },
})
```
