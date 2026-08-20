export type {
  CaseContextSeed, CaseKind, CaseOutcome, CaseResult, EvalCase, EvalReport, EvalStep,
  RuleTally, StepResult, TagTally,
} from './types'
export { evaluate, runCase, type EvaluateOptions } from './runner'
export { runCaseObserved } from './observe'
export { scoreCurve, type CurvePoint, type ScoreCurveOptions } from './curve'
export {
  diffReplay, parseRuns, recordingGuard, serializeRuns,
  type RecordedRun, type ReplayDiff, type ReplayReport,
} from './record'
export {
  coverageMatrix, renderCoverageMarkdown,
  type CoverageMatrix, type CoverageRow, type CoveringRule,
} from './coverage'
export {
  THREAT_CATALOG, THREAT_CATALOG_VERSION, normalizeThreatId,
  type ThreatEntry, type ThreatList,
} from './threat-catalog'
export {
  EVAL_DATASET_VERSION, dataCases, ioCases, referenceDataGuard, referenceIoGuard,
} from './dataset'
