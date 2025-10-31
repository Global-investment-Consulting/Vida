import { z } from "zod";

export const VAT_RATES = [0, 6, 12, 21] as const;

const NonEmptyString = z.string().trim().min(1);

const CurrencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, { message: "currency must be a 3-letter ISO code" });

const CountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, { message: "countryCode must be ISO 3166-1 alpha-2" });

const VatRateSchema = z.coerce
  .number()
  .refine((value) => VAT_RATES.includes(value as (typeof VAT_RATES)[number]), {
    message: `vatRate must be one of: ${VAT_RATES.join(", ")}`
  });

const EndpointSchema = z.object({
  id: NonEmptyString,
  scheme: NonEmptyString
});

const AddressSchema = z
  .object({
    streetName: NonEmptyString.optional(),
    additionalStreetName: z.string().trim().optional(),
    buildingNumber: z.string().trim().optional(),
    cityName: NonEmptyString.optional(),
    postalZone: z.string().trim().optional(),
    countryCode: CountryCodeSchema.default("BE")
  })
  .partial({ streetName: true, cityName: true });

const ContactSchema = z.object({
  name: NonEmptyString.optional(),
  telephone: z.string().trim().optional(),
  electronicMail: z.string().trim().optional()
});

const PartySchema = z.object({
  name: NonEmptyString,
  registrationName: NonEmptyString.optional(),
  companyId: z.string().trim().optional(),
  vatId: z.string().trim().optional(),
  endpoint: EndpointSchema.optional(),
  address: AddressSchema.optional(),
  contact: ContactSchema.optional(),
  legalRegistrationId: z.string().trim().optional()
});

const MinorAmountSchema = z.coerce.number().int();

const InvoiceLineSchema = z.object({
  id: NonEmptyString.optional(),
  description: NonEmptyString,
  quantity: z.coerce.number().positive(),
  unitCode: z.string().trim().min(1).default("EA"),
  unitPriceMinor: MinorAmountSchema.nonnegative(),
  discountMinor: MinorAmountSchema.min(0).default(0),
  vatRate: VatRateSchema.optional(),
  vatCategory: z
    .enum(["S", "Z", "E", "AE", "O", "L", "AA"])
    .optional(),
  vatExemptionReason: z.string().trim().optional(),
  itemName: z.string().trim().optional(),
  buyerAccountingReference: z.string().trim().optional()
});

const InvoiceAllowanceSchema = z.object({
  reason: z.string().trim().optional(),
  amountMinor: MinorAmountSchema.min(0),
  baseAmountMinor: MinorAmountSchema.min(0).optional()
});

const PartialTotalsSchema = z.object({
  lineExtensionTotalMinor: MinorAmountSchema.min(0).optional(),
  taxTotalMinor: MinorAmountSchema.optional(),
  payableAmountMinor: MinorAmountSchema.optional(),
  allowanceTotalMinor: MinorAmountSchema.min(0).optional(),
  chargeTotalMinor: MinorAmountSchema.min(0).optional(),
  roundingMinor: MinorAmountSchema.optional()
});

const DateLikeSchema = z
  .union([z.string(), z.number(), z.date()])
  .transform((value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid date");
    }
    return date;
  });

const MetaSchema = z.object({}).catchall(z.unknown());

export const InvoiceSchema = z
  .object({
    id: z.string().trim().optional(),
    invoiceNumber: NonEmptyString,
    currency: CurrencyCodeSchema,
    issueDate: DateLikeSchema,
    dueDate: DateLikeSchema.optional(),
    taxPointDate: DateLikeSchema.optional(),
    buyer: PartySchema,
    supplier: PartySchema.extend({
      vatId: NonEmptyString
    }),
    buyerReference: z.string().trim().optional(),
    orderReference: z.string().trim().optional(),
    paymentReference: z.string().trim().optional(),
    paymentTerms: z.string().trim().optional(),
    notes: z.array(z.string().trim()).optional(),
    currencyMinorUnit: z.number().int().min(0).max(3).default(2),
    defaultVatRate: VatRateSchema.optional().default(21),
    lines: z.array(InvoiceLineSchema).min(1),
    allowances: z.array(InvoiceAllowanceSchema).optional().default([]),
    totals: PartialTotalsSchema.optional(),
    roundingMinor: MinorAmountSchema.optional(),
    meta: MetaSchema.optional()
  })
  .superRefine((invoice, ctx) => {
    invoice.lines.forEach((line, index) => {
      const rate = line.vatRate ?? invoice.defaultVatRate;
      if (!VAT_RATES.includes(rate as (typeof VAT_RATES)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index, "vatRate"],
          message: `Unsupported VAT rate ${rate}. Allowed: ${VAT_RATES.join(", ")}`
        });
      }
    });

    if (!invoice.supplier.vatId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supplier", "vatId"],
        message: "supplier.vatId is required"
      });
    }
  });

export type InvoiceParty = z.infer<typeof PartySchema> & { vatId?: string };
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;
export type InvoiceAllowance = z.infer<typeof InvoiceAllowanceSchema>;
export type InvoiceTotals = z.infer<typeof PartialTotalsSchema>;
export type NormalizedInvoice = z.infer<typeof InvoiceSchema>;

export function parseInvoice(input: unknown): NormalizedInvoice {
  return InvoiceSchema.parse(input);
}
