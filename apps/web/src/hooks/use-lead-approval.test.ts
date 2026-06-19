// @vitest-environment node
//
// FR-055 — unit tests for use-lead-approval hook helpers.
// These cover `approvalErrorMessage` (pure function) without requiring a DOM.
import { describe, it, expect } from 'vitest';
import { approvalErrorMessage } from './use-lead-approval';
import { ApiClientError } from '@/lib/api';

describe('approvalErrorMessage', () => {
  it('returns conflict message for 409', () => {
    const err = new ApiClientError({
      code: 'CONFLICT',
      message: 'Lead is not in pending_approval stage',
      status: 409,
      retryable: false,
    });
    expect(approvalErrorMessage(err)).toBe('Lead is no longer awaiting approval.');
  });

  it('returns forbidden message for 403', () => {
    const err = new ApiClientError({
      code: 'FORBIDDEN',
      message: 'Forbidden',
      status: 403,
      retryable: false,
    });
    expect(approvalErrorMessage(err)).toBe("You don't have permission to approve this lead.");
  });

  it('returns first field issue for 400 with fields', () => {
    const err = new ApiClientError({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      status: 400,
      retryable: false,
      fields: [{ field: 'reason', issue: 'Reason is required when rejecting' }],
    });
    expect(approvalErrorMessage(err)).toBe('Reason is required when rejecting');
  });

  it('returns the error message for 400 without fields', () => {
    const err = new ApiClientError({
      code: 'VALIDATION_ERROR',
      message: 'Reason must be at least 5 characters',
      status: 400,
      retryable: false,
    });
    expect(approvalErrorMessage(err)).toBe('Reason must be at least 5 characters');
  });

  it('returns generic message for unknown errors', () => {
    expect(approvalErrorMessage(new Error('network error'))).toBe(
      'Could not submit decision. Please try again.',
    );
  });

  it('returns generic message for non-Error thrown values', () => {
    expect(approvalErrorMessage('some string error')).toBe(
      'Could not submit decision. Please try again.',
    );
  });
});
