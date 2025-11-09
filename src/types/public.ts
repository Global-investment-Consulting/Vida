import { z } from "zod";

const NonEmptyString = z.string().trim().min(1, "required");

const CurrencyCode = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => value.length === 3, {
    message: "currency must be ISO 4217 (3 letters)"
  });

const CountryCode = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => value.length === 2, {
    message: "countryCode must be ISO 3166-1 alpha-2"
  });

const DateISO = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "invalid ISO date"
  });

const EndpointSchema = z
  .object({
    id: NonEmptyString.optional(),
    scheme: NonEmptyString.optional()
  })
  .refine((value) => {
    if (!value.id && !value.scheme) {
      return true;
    }
    return Boolean(value.id && value.scheme);
  }, "endpoint.scheme required when endpoint.id is present");

const AddressSchema = z.object({
  streetName: z.string().trim().optional(),
  additionalStreetName: z.string().trim().optional(),
  buildingNumber: z.string().trim().optional(),
  cityName: z.string().trim().optional(),
  postalZone: z.string().trim().optional(),
  countryCode: CountryCode.optional()
});

const ContactSchema = z.object({
  name: z.string().trim().optional(),
  telephone: z.string().trim().optional(),
  electronicMail: z.string().trim().optional()
});

const PartySchema = z.object({
  name: NonEmptyString,
  registrationName: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
  vatId: z.string().trim().optional(),
  endpoint: EndpointSchema.optional(),
  address: AddressSchema.optional(),
  contact: ContactSchema.optional()
});

const NonNegativeMinor = z.coerce.number().int().min(0);

export const InvoiceLineSchema = z.object({
  id: z.string().trim().optional(),
  description: NonEmptyString,
  quantity: z.coerce.number().positive(),
  unitCode: z.string().trim().min(1).default("EA"),
  unitPriceMinor: NonNegativeMinor,
  discountMinor: NonNegativeMinor.default(0),
  vatRate: z.coerce.number().int().min(0).max(100).optional(),
  vatCategory: z.enum(["S", "Z", "E", "AE"]).optional(),
  vatExemptionReason: z.string().trim().optional(),
  itemName: z.string().trim().optional(),
  buyerAccountingReference: z.string().trim().optional()
});

const TotalsSchema = z.object({
  lineExtensionTotalMinor: NonNegativeMinor.optional(),
  taxTotalMinor: NonNegativeMinor.optional(),
  payableAmountMinor: NonNegativeMinor.optional(),
  allowanceTotalMinor: NonNegativeMinor.optional(),
  chargeTotalMinor: NonNegativeMinor.optional(),
  roundingMinor: z.coerce.number().int().optional()
});

export const InvoiceDtoSchema = z.object({
  externalReference: z.string().trim().optional(),
  currency: CurrencyCode,
  currencyMinorUnit: z.number().int().min(0).max(3).default(2),
  issueDate: DateISO,
  dueDate: DateISO.optional(),
  seller: PartySchema,
  buyer: PartySchema,
  lines: z.array(InvoiceLineSchema).min(1),
  defaultVatRate: z.coerce.number().int().min(0).max(100).optional(),
  totals: TotalsSchema.optional(),
  meta: z.record(z.string(), z.any()).optional()
});

export type InvoiceDTO = z.infer<typeof InvoiceDtoSchema>;
