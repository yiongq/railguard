/** JSONL 事件溯源审批存储(Node 专属:src/node 是唯一允许 node: 导入的子路径)。
 *  每次状态迁移追加一行,启动时回放重建内存态;只容忍末行半截写入(崩溃残留)。 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MemoryApprovalStore, type ApprovalEvent, type ApprovalRecord } from '../data/approvals'

export class JsonlApprovalStore extends MemoryApprovalStore {
  private ready: Promise<void> | null = null

  constructor(private readonly filePath: string) {
    super()
  }

  private async ensureLoaded(): Promise<void> {
    this.ready ??= this.load()
    await this.ready
  }

  private async load(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim()
      if (line === undefined || line === '') continue
      let event: ApprovalEvent
      try {
        event = JSON.parse(line) as ApprovalEvent
      } catch (err) {
        // 只容忍最后一行的半截写入;非末行解析失败是真实损坏,照抛
        const isLastContentLine = lines.slice(i + 1).every((l) => l.trim() === '')
        if (isLastContentLine) {
          console.warn(`[railguard] 跳过审批日志末尾半截记录(疑似崩溃残留):${this.filePath}`)
          break
        }
        throw err
      }
      this.replay(event)
    }
  }

  protected override async persist(event: ApprovalEvent): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  override async find(system: string, userId: string, tool: string, argsHash: string): Promise<ApprovalRecord | null> {
    await this.ensureLoaded()
    return super.find(system, userId, tool, argsHash)
  }
  override async get(id: string): Promise<ApprovalRecord | null> {
    await this.ensureLoaded()
    return super.get(id)
  }
  override async create(input: Omit<ApprovalRecord, 'id' | 'status' | 'createdAt'>): Promise<ApprovalRecord> {
    await this.ensureLoaded()
    return super.create(input)
  }
  override async decide(id: string, status: 'approved' | 'denied', approverId: string): Promise<ApprovalRecord> {
    await this.ensureLoaded()
    return super.decide(id, status, approverId)
  }
  override async consume(id: string): Promise<ApprovalRecord> {
    await this.ensureLoaded()
    return super.consume(id)
  }
  override async annotate(id: string, meta: Record<string, string>): Promise<ApprovalRecord> {
    await this.ensureLoaded()
    return super.annotate(id, meta)
  }
  override async listPending(): Promise<ApprovalRecord[]> {
    await this.ensureLoaded()
    return super.listPending()
  }
}
