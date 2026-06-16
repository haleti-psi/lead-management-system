import { describe, it, expect } from 'vitest';
import { ApiClientError } from '@/lib/api';
import { actionErrorMessage, normaliseDiff, statusTone } from './config-governance-utils';

describe('config-governance-utils', () => {
  describe('normaliseDiff', () => {
    it('handles per-field before/after objects', () => {
      const rows = normaliseDiff({ threshold: { before: 30, after: 45 } });
      expect(rows).toEqual([{ field: 'threshold', before: 30, after: 45 }]);
    });

    it('recognises from/to and old/new aliases', () => {
      expect(normaliseDiff({ a: { from: 1, to: 2 } })).toEqual([{ field: 'a', before: 1, after: 2 }]);
      expect(normaliseDiff({ b: { old: 'x', new: 'y' } })).toEqual([{ field: 'b', before: 'x', after: 'y' }]);
    });

    it('treats a scalar field value as the after value', () => {
      expect(normaliseDiff({ enabled: true })).toEqual([{ field: 'enabled', after: true }]);
    });

    it('handles a top-level before/after pair', () => {
      expect(normaliseDiff({ before: { x: 1 }, after: { x: 2 } })).toEqual([
        { field: 'value', before: { x: 1 }, after: { x: 2 } },
      ]);
    });

    it('returns an empty list for null/undefined diffs', () => {
      expect(normaliseDiff(null)).toEqual([]);
      expect(normaliseDiff(undefined)).toEqual([]);
    });
  });

  describe('statusTone', () => {
    it('maps each config status to a distinct tone', () => {
      expect(statusTone('pending')).toBe('progress');
      expect(statusTone('active')).toBe('success');
      expect(statusTone('rejected')).toBe('danger');
      expect(statusTone('rolled_back')).toBe('neutral');
      expect(statusTone('approved')).toBe('info');
    });
  });

  describe('actionErrorMessage', () => {
    function err(code: string): ApiClientError {
      return new ApiClientError({ code: code as never, message: 'raw', status: 400, retryable: false });
    }

    it('explains maker-checker FORBIDDEN and CONFLICT clearly', () => {
      expect(actionErrorMessage(err('FORBIDDEN'))).toMatch(/can't approve a change you made/i);
      expect(actionErrorMessage(err('CONFLICT'))).toMatch(/already been acted on/i);
      expect(actionErrorMessage(err('NOT_FOUND'))).toMatch(/no pending configuration change/i);
    });

    it('falls back to a generic message for non-api errors', () => {
      expect(actionErrorMessage(new Error('boom'))).toMatch(/could not be completed/i);
    });
  });
});
