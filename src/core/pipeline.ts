import type {
  AuditEvent, Guard, GuardConfig, GuardContext, HookPoint, HookRunResult,
  Rule, RuleMode, RuleOutcome,
} from './types'

/** 无外部熵源的请求 id(纯 Math.random 足够:它是关联审计事件用的,不是密钥) */
function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
}

function emptyContext(label?: string): GuardContext {
  const ctx: GuardContext = {
    requestId: newRequestId(),
    trace: [],
    taint: { untrustedSources: [], touchedPrivateData: false, externalCommsRequested: false },
    kv: new Map(),
  }
  if (label !== undefined) ctx.label = label
  return ctx
}

async function runRule<T>(
  rule: Rule<T>,
  input: T,
  ctx: GuardContext,
): Promise<RuleOutcome<T>> {
  try {
    return await rule.check(input, ctx)
  } catch (err) {
    // 规则自身报错与内容违规是两回事(status 与 verdict 正交)
    const reason = `规则执行异常: ${err instanceof Error ? err.message : String(err)}`
    if ((rule.failMode ?? 'open') === 'closed') {
      return { verdict: 'blocked', status: 'error', reason }
    }
    return { verdict: 'pass', status: 'error', reason }
  }
}

/**
 * 创建守卫实例。执行语义(每一条都有测试钉住):
 * - 规则按注册顺序执行,不按 cost 重排——顺序是承重的(先建单再核链接这类依赖真实存在)
 * - off:跳过,不产生审计事件
 * - observe:真实执行 check 并记审计,但结果不生效(不改写、不拦截),流水线继续
 * - enforce:modified 改写后继续;blocked / escalated 短路整条钩子链
 * - check() 入口等价于全规则 observe,永不改变输入
 */
export function createGuard(config: GuardConfig): Guard {
  // 挂载校验:规则声明的 hook 必须与挂载位置一致,挂错门直接拒绝启动
  for (const [hook, rules] of Object.entries(config.hooks)) {
    for (const rule of rules ?? []) {
      if (rule.hook !== hook) {
        throw new Error(`规则 ${rule.id} 声明 hook=${rule.hook},却被挂在 ${hook}`)
      }
    }
  }

  const defaultMode: RuleMode = config.defaultMode ?? 'enforce'

  async function execute<T>(
    hook: HookPoint,
    input: T,
    ctx: GuardContext,
    forceObserve: boolean,
  ): Promise<HookRunResult<T>> {
    const rules = (config.hooks[hook] ?? []) as readonly Rule<T>[]
    const events: AuditEvent[] = []
    let current = input
    let aggregate: HookRunResult<T>['verdict'] = 'pass'

    for (const rule of rules) {
      const mode: RuleMode = forceObserve ? 'observe' : (rule.mode ?? defaultMode)
      if (mode === 'off') continue

      const outcome = await runRule(rule, current, ctx)
      const effective = mode === 'enforce'
      const event: AuditEvent = {
        at: new Date().toISOString(),
        requestId: ctx.requestId,
        hookPoint: hook,
        ruleId: rule.id,
        ruleVersion: rule.version,
        mode,
        verdict: outcome.verdict,
        status: outcome.status,
        rescued: effective && outcome.verdict !== 'pass',
      }
      if (ctx.label !== undefined) event.label = ctx.label
      if (outcome.score !== undefined) event.score = outcome.score
      if (outcome.reason !== undefined) event.reason = outcome.reason
      events.push(event)
      if (config.audit) await config.audit(event)

      if (!effective) continue // observe:记录但不生效

      if (outcome.verdict === 'modified' && outcome.transformed !== undefined) {
        current = outcome.transformed
        aggregate = 'modified'
      } else if (outcome.verdict === 'blocked') {
        const blocked: HookRunResult<T>['blocked'] = { ruleId: rule.id }
        if (outcome.reason !== undefined) blocked.reason = outcome.reason
        return { ok: false, verdict: 'blocked', output: current, blocked, events }
      } else if (outcome.verdict === 'escalated') {
        const escalation: HookRunResult<T>['escalation'] = { ruleId: rule.id }
        if (outcome.reason !== undefined) escalation.reason = outcome.reason
        if (outcome.evidence !== undefined) escalation.payload = outcome.evidence
        return { ok: false, verdict: 'escalated', output: current, escalation, events }
      }
    }

    return { ok: true, verdict: aggregate, output: current, events }
  }

  return {
    run: (hook, input, ctx) => execute(hook, input, ctx, false),
    check: (hook, input, ctx) => execute(hook, input, ctx, true),
    context: (init?: Partial<GuardContext>): GuardContext => ({ ...emptyContext(config.label), ...init }),
    rules: (): readonly Rule[] => Object.values(config.hooks).flatMap((r) => [...(r ?? [])]),
  }
}
