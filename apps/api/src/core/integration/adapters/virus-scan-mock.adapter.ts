import { Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@lms/shared';

import { DomainException } from '../../http/domain-exception';
import type { VirusScanPort, VirusScanRequest } from '../ports/virus-scan.port';

/**
 * Deterministic in-process {@link VirusScanPort} for dev/test (FR-070-tests.md:
 * "Mock adapters: VirusScanMockAdapter"). No network I/O and no library — it
 * records the enqueued scans so a test can assert dispatch, and the scan VERDICT
 * is then driven explicitly by invoking the internal scan-result callback (the
 * real async transport is Cloud Tasks; in tests the callback is called directly).
 */
@Injectable()
export class VirusScanMockAdapter implements VirusScanPort {
  private readonly enqueued: VirusScanRequest[] = [];
  private failOnce = false;

  /** Scans this mock was asked to enqueue (test assertion helper). */
  enqueuedScans(): readonly VirusScanRequest[] {
    return this.enqueued;
  }

  /** Force the NEXT `scanObject` call to throw `UPSTREAM_UNAVAILABLE` (503). */
  failNext(): void {
    this.failOnce = true;
  }

  async scanObject(request: VirusScanRequest): Promise<void> {
    if (this.failOnce) {
      this.failOnce = false;
      throw new DomainException(ERROR_CODES.UPSTREAM_UNAVAILABLE);
    }
    this.enqueued.push(request);
  }
}
