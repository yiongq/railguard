import type { AuditEvent, Guard, GuardContext, Taint } from '../core/types'
import type { EvalCase } from './types'

function cloneTaint(taint: Taint): Taint {
  return {
    untrustedSources: [...taint.untrustedSources],
    touchedPrivateData: taint.touchedPrivateData,
    externalCommsRequested: taint.externalCommsRequested,
  }
}

/** observe 全跑:guard.check 不拦截不改写,拿到全部规则的事件(含 score) */
export async function runCaseObserved(guard: Guard, evalCase: EvalCase): Promise<AuditEvent[]> {
  const init: Partial<GuardContext> = {}
  const seed = evalCase.context
  if (seed?.principal !== undefined) init.principal = seed.principal
  if (seed?.agent !== undefined) init.agent = seed.agent
  if (seed?.channel !== undefined) init.channel = seed.channel
  if (seed?.taint !== undefined) init.taint = cloneTaint(seed.taint)
  const ctx = guard.context(init)

  const events: AuditEvent[] = []
  for (const step of evalCase.steps) {
    if (step.channel !== undefined) ctx.channel = step.channel
    const r = await guard.check(step.hook, step.payload, ctx)
    events.push(...r.events)
  }
  return events
}
