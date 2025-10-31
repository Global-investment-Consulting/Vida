type UnknownRecord = Record<string, unknown>;

export interface ScradaAddress extends UnknownRecord {
  streetName: string;
  buildingNumber?: string;
  additionalStreetName?: string;
  postalZone: string;
  cityName: string;
  countryCode: string;
}

export interface ScradaContact extends UnknownRecord {
  name?: string;
  email?: string;
  telephone?: string;
}

export interface ScradaParty extends UnknownRecord {
  name: string;
  vatNumber?: string;
  companyRegistrationNumber?: string;
  peppolId?: string;
  schemeId?: string;
  address: ScradaAddress;
  contact?: ScradaContact;
}

export interface ScradaAmount extends UnknownRecord {
  currency: string;
  value: number;
}

export interface ScradaVatDetail extends UnknownRecord {
  rate: number;
  taxableAmount: ScradaAmount;
  taxAmount: ScradaAmount;
  exemptionReasonCode?: string;
}

export interface ScradaInvoiceLine extends UnknownRecord {
  id: string;
  description: string;
  quantity: number;
  unitCode?: string;
  unitPrice: ScradaAmount;
  lineExtensionAmount: ScradaAmount;
  vat: ScradaVatDetail;
  allowances?: ScradaAmount[];
  charges?: ScradaAmount[];
}

export interface ScradaInvoiceTotals extends UnknownRecord {
  taxExclusiveAmount: ScradaAmount;
  taxInclusiveAmount: ScradaAmount;
  payableAmount: ScradaAmount;
  lineExtensionAmount: ScradaAmount;
  taxTotals: ScradaVatDetail[];
}

export interface ScradaPaymentTerms extends UnknownRecord {
  note?: string;
  paymentDueDate?: string;
  paymentMeansCode?: string;
  paymentMeansText?: string;
  paymentId?: string;
}

export interface ScradaSalesInvoice extends UnknownRecord {
  profileId?: string;
  customizationId?: string;
  id: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  buyer: ScradaParty;
  seller: ScradaParty;
  totals: ScradaInvoiceTotals;
  lines: ScradaInvoiceLine[];
  paymentTerms?: ScradaPaymentTerms;
  orderReference?: string;
  externalReference?: string;
  note?: string;
}

export interface ScradaStatusInfo extends UnknownRecord {
  code?: string;
  description?: string;
  occurredAt?: string;
}

export interface ScradaOutboundInfo extends UnknownRecord {
  documentId: string;
  status: string;
  externalReference?: string;
  peppolDocumentId?: string;
  receiverPeppolId?: string;
  createdAt?: string;
  updatedAt?: string;
  lastAttemptAt?: string;
  deliveredAt?: string;
  attempts?: number;
  errorMessage?: string;
  warnings?: string[];
  statusInfo?: ScradaStatusInfo;
}

export interface ScradaWebhookStatusUpdateEvent extends UnknownRecord {
  id: string;
  topic: "peppolOutboundDocument/statusUpdate";
  createdAt?: string;
  data: {
    documentId: string;
    status: string;
    previousStatus?: string;
    externalReference?: string;
    attempts?: number;
    errorMessage?: string;
    occurredAt?: string;
    statusInfo?: ScradaStatusInfo;
    [key: string]: unknown;
  };
}

export type ScradaWebhookEvent =
  | ScradaWebhookStatusUpdateEvent
  | {
      id: string;
      topic: string;
      createdAt?: string;
      data?: Record<string, unknown>;
      [key: string]: unknown;
    };

export interface ScradaParticipantSummary extends UnknownRecord {
  participantId?: string;
  participantScheme?: string;
  name?: string;
  countryCode?: string;
  identifiers?: UnknownRecord;
  addresses?: UnknownRecord[];
  contact?: UnknownRecord;
}

export interface ScradaParticipantLookupResponse extends UnknownRecord {
  exists?: boolean;
  participantExists?: boolean;
  participants?: ScradaParticipantSummary[];
  info?: UnknownRecord;
  status?: string;
}

export interface ScradaParticipantLookupResult {
  peppolId: string;
  exists: boolean;
  response: ScradaParticipantLookupResponse;
}

export interface RegisterCompanyInput extends UnknownRecord {
  companyName: string;
  countryCode: string;
  vatNumber?: string;
  endpointUrl: string;
  contactEmail?: string;
  contactName?: string;
}
