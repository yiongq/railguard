import type { AuditEvent, AuditSink } from '../core/types'

/** 内存 sink:测试与评测用 */
export function memorySink(): { sink: AuditSink; events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return { sink: (e: AuditEvent): void => { events.push(e) }, events }
}

/** console JSON lines sink:每事件一行结构化 JSON(Node 与 edge 通用) */
export function consoleSink(logger: (line: string) => void = console.log): AuditSink {
  return (e: AuditEvent): void => logger(JSON.stringify({ evt: 'railguard', ...e }))
}

export type { AuditEvent, AuditSink } from '../core/types'
export {
  AuditChainSigner, GENESIS, computeChainHash, exportKeyJwk, generateAuditKeypair,
  importPrivateKeyJwk, importPublicKeyJwk, parseSignedAuditLog, verifyAuditChain,
  type AuditKeypair, type ChainHead, type SignedAuditEvent, type VerifyResult,
} from './chain'
