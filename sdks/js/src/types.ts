export type Endpoint = {
  id?: string;
  scheme?: string;
};

export type Address = {
  streetName?: string;
  additionalStreetName?: string;
  buildingNumber?: string;
  cityName?: string;
  postalZone?: string;
  countryCode?: string;
};

export type Contact = {
  name?: string;
  telephone?: string;
  electronicMail?: string;
};

export type Party = {
  name: string;
  registrationName?: string;
  companyId?: string;
  vatId?: string;
  endpoint?: Endpoint;
  address?: Address;
  contact?: Contact;
};

export type InvoiceLine = {
  id?: string;
  description: string;
  quantity: number;
  unitCode?: string;
  unitPriceMinor: number;
  discountMinor?: number;
  vatRate?: number;
  vatCategory?: "S" | "Z" | "E" | "AE";
  vatExemptionReason?: string;
  itemName?: string;
  buyerAccountingReference?: string;
};

export type InvoiceTotals = {
  lineExtensionTotalMinor?: number;
  taxTotalMinor?: number;
  payableAmountMinor?: number;
  allowanceTotalMinor?: number;
  chargeTotalMinor?: number;
  roundingMinor?: number;
};

export type InvoiceSubmission = {
  externalReference?: string;
  currency: string;
  currencyMinorUnit?: number;
  issueDate: string;
  dueDate?: string;
  seller: Party;
  buyer: Party;
  lines: InvoiceLine[];
  defaultVatRate?: number;
  totals?: InvoiceTotals;
  meta?: Record<string, unknown>;
};

export type InvoiceSubmissionResponse = {
  invoiceId: string;
  documentId: string;
  status: string;
  externalReference: string;
};

export type InvoiceStatusResponse = {
  invoiceId: string;
  documentId: string;
  status: string;
  info?: Record<string, unknown> | null;
};
