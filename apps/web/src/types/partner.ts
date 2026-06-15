/** FR-090 — partner list-row view (mirrors the API PartnerView; mobile masked). */
export interface PartnerView {
  partnerId: string;
  partnerCode: string;
  type: string;
  legalName: string;
  branchId: string | null;
  products: string[];
  contactPerson: string | null;
  contactMobile: string | null;
  status: string;
  agreementRef: string | null;
  commissionFlag: boolean;
  mappedRmId: string | null;
  riskCategory: string | null;
  qualityScore: number | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePartnerBody {
  partnerCode: string;
  type: string;
  legalName: string;
  products?: string[];
  contactPerson?: string;
  contactMobile?: string;
  agreementRef?: string;
  riskCategory?: string;
  validUntil?: string;
}

export interface UpdatePartnerBody {
  legalName?: string;
  products?: string[];
  contactPerson?: string;
  contactMobile?: string;
  agreementRef?: string;
  riskCategory?: string;
  validUntil?: string;
  status?: string;
  statusReason?: string;
}
