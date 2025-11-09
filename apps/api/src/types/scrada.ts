type UnknownRecord = Record<string, unknown>;

export interface ScradaInvoiceAddress extends UnknownRecord {
  street?: string;
  streetNumber?: string;
  streetBox?: string;
  zipCode?: string;
  city?: string;
  countrySubentity?: string;
  countryCode: string;
}

export interface ScradaExtraIdentifier extends UnknownRecord {
  scheme?: string;
  value?: string;
}

export interface ScradaInvoiceParty extends UnknownRecord {
  name: string;
  code?: string;
  contact?: string;
  email?: string;
  invoiceEmail?: string;
  phone?: string;
  languageCode?: string;
  legalPersonRegister?: string;
  vatNumber?: string;
  taxNumber?: string;
  taxNumberType?: number;
  vatStatus?: number;
  glnNumber?: string;
  peppolID?: string;
  extraIdentifiers?: ScradaExtraIdentifier[];
  address: ScradaInvoiceAddress;
}

export interface ScradaInvoiceLine extends UnknownRecord {
  lineNumber: string;
  itemName: string;
  quantity: number;
  unitType?: number;
  itemExclVat?: number;
  itemInclVat?: number;
  totalExclVat?: number;
  totalInclVat?: number;
  vatType: number;
  vatPercentage: number;
  totalDiscountExclVat?: number;
  totalDiscountInclVat?: number;
  invoicePeriodStartDate?: string;
  invoicePeriodEndDate?: string;
  standardItemIdentifierType?: number;
  standardItemIdentifier?: string;
  purchaseOrderLineReference?: string;
  additionalProperties?: UnknownRecord[];
}

export interface ScradaVatTotal extends UnknownRecord {
  vatType: number;
  vatPercentage: number;
  totalExclVat?: number;
  totalVat: number;
  totalInclVat?: number;
  note?: string;
}

export interface ScradaInvoiceAttachment extends UnknownRecord {
  name?: string;
  description?: string;
  externalReference?: string;
  contentType?: string;
  content?: string;
}

export interface ScradaSalesInvoice extends UnknownRecord {
  id?: string;
  number: string;
  externalReference?: string;
  creditInvoice?: boolean;
  isInclVat?: boolean;
  invoiceReference?: string;
  invoiceDate: string;
  invoiceExpiryDate?: string;
  buyerReference?: string;
  purchaseOrderReference?: string;
  salesOrderReference?: string;
  despatchDocumentReference?: string;
  supplier: ScradaInvoiceParty;
  customer: ScradaInvoiceParty;
  delivery?: UnknownRecord;
  totalExclVat?: number;
  totalInclVat?: number;
  totalVat: number;
  currency?: string;
  payableRoundingAmount?: number;
  note?: string;
  lines: ScradaInvoiceLine[];
  vatTotals: ScradaVatTotal[];
  paymentTerms?: string;
  paymentMethods?: UnknownRecord[];
  attachments?: ScradaInvoiceAttachment[];
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
