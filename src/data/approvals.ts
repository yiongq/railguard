/** 审批单与存储(自 mcp-foundry 迁入;node:crypto → 全局 crypto,JSONL 实现在 ./node)。
 *  语义不变量:幂等开单 / 一票一次 / 同步抢占防并发重放 / 预写日志失败回滚 / 惰性过期。
 *  注意:审批单存 args 原文(审批人要看清在批什么),与只存 argsHash 的审计日志
 *  保密等级不同,持久化文件须同级对待。 */

export interface ApprovalRecord {
  id: string
  system: string
  tool: string
  args: Record<string, unknown>
  argsHash: string
  /** 发起人(不是审批人)——续跑时按此身份重新走守卫 */
  userId: string
  role: string
  status: 'pending' | 'approved' | 'denied'
  createdAt: string
  expiresAt: string
  decidedAt?: string
  approverId?: string
  consumedAt?: string
  /** 宿主附加上下文(如 IM 会话 id,审批后把结果推回原对话) */
  meta?: Record<string, string>
}

export interface ApprovalStore {
  /** 同发起人+同工具+同参数指纹的未消费未过期单(幂等:重复调用不重复开单) */
  find(system: string, userId: string, tool: string, argsHash: string): Promise<ApprovalRecord | null>
  get(id: string): Promise<ApprovalRecord | null>
  create(record: Omit<ApprovalRecord, 'id' | 'status' | 'createdAt'>): Promise<ApprovalRecord>
  decide(id: string, status: 'approved' | 'denied', approverId: string): Promise<ApprovalRecord>
  /** 消费一张已决单:同一张单只放行/拒绝一次,防重放 */
  consume(id: string): Promise<ApprovalRecord>
  annotate(id: string, meta: Record<string, string>): Promise<ApprovalRecord>
  listPending(): Promise<ApprovalRecord[]>
}

export type ApprovalEvent =
  | { type: 'created'; record: ApprovalRecord }
  | { type: 'decided'; id: string; status: 'approved' | 'denied'; approverId: string; decidedAt: string }
  | { type: 'consumed'; id: string; consumedAt: string }
  | { type: 'annotated'; id: string; meta: Record<string, string> }

function isOpen(record: ApprovalRecord, now: Date): boolean {
  return record.consumedAt === undefined && new Date(record.expiresAt) > now
}

/**
 * find() 择优:已决单优先于 pending(否则并发重复单里,已批准的旧单被 pending
 * 挤掉、迟迟消费不掉,变成长期悬挂的已批准单);同类取较新。
 */
function preferOver(candidate: ApprovalRecord, current: ApprovalRecord): boolean {
  const decided = (r: ApprovalRecord): number => (r.status === 'pending' ? 0 : 1)
  if (decided(candidate) !== decided(current)) return decided(candidate) > decided(current)
  return candidate.createdAt > current.createdAt
}

/** 内存实现;也是事件溯源持久化实现回放后的内核(persist 是子类钩子) */
export class MemoryApprovalStore implements ApprovalStore {
  protected readonly records: Map<string, ApprovalRecord> = new Map()

  async find(system: string, userId: string, tool: string, argsHash: string): Promise<ApprovalRecord | null> {
    const now = new Date()
    let best: ApprovalRecord | null = null
    for (const record of this.records.values()) {
      if (
        record.system === system && record.userId === userId &&
        record.tool === tool && record.argsHash === argsHash &&
        isOpen(record, now) && (best === null || preferOver(record, best))
      ) {
        best = record
      }
    }
    return best
  }

  async get(id: string): Promise<ApprovalRecord | null> {
    return this.records.get(id) ?? null
  }

  // 预写日志纪律:先落盘事件、成功后再改内存;失败则内存不变/回滚——
  // 防「内存已生效、盘上没记」重启后凭空回退,同一单被二次批复/执行。

  async create(input: Omit<ApprovalRecord, 'id' | 'status' | 'createdAt'>): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      ...input,
      id: globalThis.crypto.randomUUID(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    await this.persist({ type: 'created', record })
    this.records.set(record.id, record)
    return record
  }

  async decide(id: string, status: 'approved' | 'denied', approverId: string): Promise<ApprovalRecord> {
    const record = this.records.get(id)
    if (!record) throw new Error(`审批单不存在:${id}`)
    if (record.status !== 'pending') throw new Error(`审批单已是 ${record.status},不能重复批复`)
    if (!isOpen(record, new Date())) throw new Error('审批单已过期')
    // 同步抢占:检查与置位间无 await,并发第二次 decide 在状态检查处即抛
    const decidedAt = new Date().toISOString()
    record.status = status
    record.approverId = approverId
    record.decidedAt = decidedAt
    try {
      await this.persist({ type: 'decided', id, status, approverId, decidedAt })
    } catch (err) {
      record.status = 'pending'
      delete record.approverId
      delete record.decidedAt
      throw err
    }
    return record
  }

  async consume(id: string): Promise<ApprovalRecord> {
    const record = this.records.get(id)
    if (!record) throw new Error(`审批单不存在:${id}`)
    if (record.consumedAt !== undefined) throw new Error('审批单已被消费')
    // 同步抢占:杜绝一张已批准单被并发重放成多次执行(一次审批被打款多次)
    const consumedAt = new Date().toISOString()
    record.consumedAt = consumedAt
    try {
      await this.persist({ type: 'consumed', id, consumedAt })
    } catch (err) {
      delete record.consumedAt
      throw err
    }
    return record
  }

  async annotate(id: string, meta: Record<string, string>): Promise<ApprovalRecord> {
    const record = this.records.get(id)
    if (!record) throw new Error(`审批单不存在:${id}`)
    await this.persist({ type: 'annotated', id, meta })
    record.meta = { ...record.meta, ...meta }
    return record
  }

  async listPending(): Promise<ApprovalRecord[]> {
    const now = new Date()
    return [...this.records.values()]
      .filter((r) => r.status === 'pending' && isOpen(r, now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** 事件回放(持久化子类启动时重建内存态用) */
  protected replay(event: ApprovalEvent): void {
    if (event.type === 'created') {
      this.records.set(event.record.id, { ...event.record })
      return
    }
    const record = this.records.get(event.id)
    if (!record) return // 半截日志按缺失处理,不炸启动
    if (event.type === 'decided') {
      record.status = event.status
      record.approverId = event.approverId
      record.decidedAt = event.decidedAt
    } else if (event.type === 'consumed') {
      record.consumedAt = event.consumedAt
    } else {
      record.meta = { ...record.meta, ...event.meta }
    }
  }

  /** 子类挂持久化钩子;内存实现为空 */
  protected async persist(_event: ApprovalEvent): Promise<void> {}
}
