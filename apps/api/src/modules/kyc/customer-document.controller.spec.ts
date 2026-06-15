import { ApplicantScope, CreationChannel, DocStatus, DocType, ERROR_CODES } from '@lms/shared';

import type { HttpRequestLike } from '../../core/http';
import type {
  CustomerLinkPort,
  ResolvedCustomerLink,
} from '../compliance/ports/customer-link.port';
import { CustomerDocumentController } from './customer-document.controller';
import type { DocumentService } from './document.service';

const LEAD = 'b0000000-0000-0000-0000-00000000000b';
const ORG = '00000000-0000-0000-0000-000000000001';
const TOKEN = 'opaque-link-token';

function req(): HttpRequestLike {
  return { headers: {} } as unknown as HttpRequestLike;
}

function resolvedLink(): ResolvedCustomerLink {
  return { leadId: LEAD, orgId: ORG, customerProfileId: null, channel: CreationChannel.WEBSITE };
}

const initiateBody = {
  doc_type: DocType.PAN,
  applicant_scope: ApplicantScope.APPLICANT,
  file_name: 'pan.pdf',
  file_type: 'application/pdf',
  file_size_kb: 200,
};

describe('CustomerDocumentController (FR-070 / FR-060 seam)', () => {
  it('404 when the token does not resolve (existence hidden) — never calls the service', async () => {
    const links: CustomerLinkPort = {
      resolveForConsent: jest.fn(),
      resolveForDocument: jest.fn(async () => null),
    };
    const documents = { initiateCustomerUpload: jest.fn(), confirmCustomerUpload: jest.fn() };
    const controller = new CustomerDocumentController(
      documents as unknown as DocumentService,
      links,
    );

    await expect(controller.customerUpload(TOKEN, initiateBody, req())).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    expect(documents.initiateCustomerUpload).not.toHaveBeenCalled();
  });

  it('Phase A: resolves the token via resolveForDocument and delegates with token scope', async () => {
    const links: CustomerLinkPort = {
      resolveForConsent: jest.fn(),
      resolveForDocument: jest.fn(async () => resolvedLink()),
    };
    const documents = {
      initiateCustomerUpload: jest.fn(async () => ({
        document_id: 'd1',
        upload_url: 'https://gcs/x',
        upload_url_expires_at: new Date(),
        status: DocStatus.PENDING,
      })),
      confirmCustomerUpload: jest.fn(),
    };
    const controller = new CustomerDocumentController(
      documents as unknown as DocumentService,
      links,
    );

    const result = await controller.customerUpload(TOKEN, initiateBody, req());

    expect(links.resolveForDocument).toHaveBeenCalledWith(TOKEN);
    expect(documents.initiateCustomerUpload).toHaveBeenCalledWith(
      expect.objectContaining({ doc_type: DocType.PAN }),
      expect.objectContaining({ leadId: LEAD, orgId: ORG }),
    );
    expect(result).toMatchObject({ status: DocStatus.PENDING });
  });

  it('Phase B: a confirm body routes to confirmCustomerUpload', async () => {
    const links: CustomerLinkPort = {
      resolveForConsent: jest.fn(),
      resolveForDocument: jest.fn(async () => resolvedLink()),
    };
    const documents = {
      initiateCustomerUpload: jest.fn(),
      confirmCustomerUpload: jest.fn(async () => ({
        document_id: 'd1',
        status: DocStatus.UPLOADED,
        virus_scan_status: 'pending',
      })),
    };
    const controller = new CustomerDocumentController(
      documents as unknown as DocumentService,
      links,
    );

    const result = await controller.customerUpload(
      TOKEN,
      { action: 'confirm', document_id: '11111111-1111-1111-1111-111111111111' },
      req(),
    );

    expect(documents.confirmCustomerUpload).toHaveBeenCalled();
    expect(documents.initiateCustomerUpload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: DocStatus.UPLOADED });
  });
});
