export { AuditAppender } from './audit-appender.service';
export type { AuditEntry } from './audit-appender.service';
export { AuditModule } from './audit.module';
export { AuditChainConsumer, AUDIT_CHAIN_BATCH_SIZE } from './audit-chain.consumer';
export {
  canonicalRow,
  canonicalJson,
  computeAfterHash,
  GENESIS_PREV_HASH,
} from './audit-canonical';
export type { CanonicalAuditRow } from './audit-canonical';
export type {
  ChainRow,
  SealResult,
  IntegrityResult,
  IntegrityBreakKind,
} from './audit-chain.types';
