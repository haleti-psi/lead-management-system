import { CommChannel } from '@lms/shared';

import type { NotificationChannelPort } from '../../../core/integration';
import type { CommunicationRepository, CommLogRow } from '../communication.repository';
import type { TemplateRepository, TemplateRow } from '../template.repository';
import { DispatchCommunicationWorker } from './dispatch-communication.worker';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMM_LOG_ID = '00000000-0000-0000-0004-000000000001';
const TEMPLATE_ID = '00000000-0000-0000-0001-000000000001';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0003-000000000001';

function makeCommLogRow(overrides: Partial<CommLogRow> = {}): CommLogRow {
  return {
    communication_log_id: COMM_LOG_ID,
    org_id: ORG_ID,
    lead_id: '00000000-0000-0000-0002-000000000001',
    template_id: TEMPLATE_ID,
    channel: CommChannel.SMS,
    recipient: '9876543210',
    consent_basis: 'lead_contact',
    status: 'queued',
    provider_ref: null,
    failure_reason: null,
    sent_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    created_by: USER_ID,
    updated_by: USER_ID,
    ...overrides,
  } as CommLogRow;
}

function makeTemplateRow(): TemplateRow {
  return { template_id: TEMPLATE_ID, code: 'DOC_SMS_V1', channel: CommChannel.SMS } as TemplateRow;
}

const fakeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makeWorker(opts: {
  logRow?: CommLogRow | undefined;
  channelThrows?: boolean;
} = {}) {
  const { logRow = makeCommLogRow(), channelThrows = false } = opts;

  const commRepo: CommunicationRepository = {
    findById: jest.fn().mockResolvedValue(logRow),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn(),
  } as unknown as CommunicationRepository;

  const templateRepo: TemplateRepository = {
    findById: jest.fn().mockResolvedValue(makeTemplateRow()),
    findActiveById: jest.fn(),
    list: jest.fn(),
    insert: jest.fn(),
  } as unknown as TemplateRepository;

  const channel: NotificationChannelPort = {
    send: channelThrows
      ? jest.fn().mockRejectedValue(new Error('503 provider error'))
      : jest.fn().mockResolvedValue(undefined),
  };

  const worker = new DispatchCommunicationWorker(
    commRepo,
    templateRepo,
    channel,
    fakeLogger as never,
  );

  return { worker, commRepo, templateRepo, channel };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DispatchCommunicationWorker', () => {
  describe('T15 — provider failure updates log, no unhandled exception', () => {
    it('marks log as failed and does not throw when provider errors', async () => {
      const { worker, commRepo } = makeWorker({ channelThrows: true });

      // Must not throw.
      await expect(worker.run({ communication_log_id: COMM_LOG_ID })).resolves.toBeUndefined();

      expect(commRepo.updateStatus).toHaveBeenCalledWith(
        COMM_LOG_ID,
        expect.objectContaining({ status: 'failed', failure_reason: expect.any(String) }),
      );
    });
  });

  describe('happy path — send success', () => {
    it('updates log to sent after successful channel dispatch', async () => {
      const { worker, commRepo, channel } = makeWorker();

      await worker.run({ communication_log_id: COMM_LOG_ID });

      expect(channel.send).toHaveBeenCalledWith(
        expect.objectContaining({ channel: CommChannel.SMS }),
      );
      expect(commRepo.updateStatus).toHaveBeenCalledWith(
        COMM_LOG_ID,
        expect.objectContaining({ status: 'sent' }),
      );
    });
  });

  describe('idempotency — already sent', () => {
    it('skips dispatch when log is already sent', async () => {
      const sentLog = makeCommLogRow({ status: 'sent' });
      const { worker, channel } = makeWorker({ logRow: sentLog });

      await worker.run({ communication_log_id: COMM_LOG_ID });

      expect(channel.send).not.toHaveBeenCalled();
    });

    it('skips dispatch when log is already delivered', async () => {
      const deliveredLog = makeCommLogRow({ status: 'delivered' });
      const { worker, channel } = makeWorker({ logRow: deliveredLog });

      await worker.run({ communication_log_id: COMM_LOG_ID });

      expect(channel.send).not.toHaveBeenCalled();
    });
  });

  describe('log not found', () => {
    it('returns without error when log row is missing', async () => {
      const { worker } = makeWorker({ logRow: undefined });

      await expect(worker.run({ communication_log_id: COMM_LOG_ID })).resolves.toBeUndefined();
    });
  });
});
