import { z } from "zod";

// Keep this aligned with invoice.ts style
export const VAT_RATES = [0, 6, 12, 21] as const;

const NonEmptyString = z.string().trim().min(1, "required");

const CurrencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, "currency must be ISO 4217 (3 letters)");

const CountryCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, "countryCode must be ISO 3166-1 alpha-2");

const VatRate = z
  .number()
  .refine((n) => VAT_RATES.includes(n as (typeof VAT_RATES)[number]), {
    message: `vatRate must be one of: ${VAT_RATES.join(", ")}`,
  });

const Endpoint = z.object({
  id: NonEmptyString,
  scheme: NonEmptyString,
}).partial().refine((o) => !o.id || !!o.scheme, {
  message: "endpoint.scheme required when endpoint.id is present",
});

const Address = z.object({
  streetName: z.string().trim().optional(),
  additionalStreetName: z.string().trim().optional(),
  buildingNumber: z.string().trim().optional(),
  cityName: z.string().trim().optional(),
  postalZone: z.string().trim().optional(),
  countryCode: CountryCode.optional(),
});

const Contact = z.object({
  name: z.string().trim().optional(),
  telephone: z.string().trim().optional(),
  electronicMail: z.string().trim().optional(),
});

const Party = z.object({
  name: NonEmptyString,
  registrationName: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
  vatId: z.string().trim().optional(),
  endpoint: Endpoint.optional(),
  address: Address.optional(),
  contact: Contact.optional(),
});

const Minor = z.coerce.number().int().min(0, "must be >= 0");

const OrderLine = z.object({
  id: z.string().trim().optional(),
  description: NonEmptyString,
  quantity: z.coerce.number().positive(),
  unitCode: z.string().trim().min(1).default("EA"),
  unitPriceMinor: Minor,          // price per unit in minor currency (e.g. cents)
  discountMinor: Minor.default(0),
  vatRate: z.number().optional(), // optional; if omitted treat as 0 in totals
  vatCategory: z.enum(["S", "Z", "E", "AE", "O", "L", "AA"]).optional(),
  vatExemptionReason: z.string().trim().optional(),
  itemName: z.string().trim().optional(),
  buyerAccountingReference: z.string().trim().optional(),
});

const PartialTotals = z.object({
  lineExtensionTotalMinor: Minor.optional(),
  taxTotalMinor: Minor.optional(),
  payableAmountMinor: Minor.optional(),
  allowanceTotalMinor: Minor.optional(),
  chargeTotalMinor: Minor.optional(),
  roundingMinor: z.coerce.number().int().optional(),
});

export const OrderSchema = z.object({
  id: z.string().trim().optional(),
  orderNumber: NonEmptyString,
  currency: CurrencyCode,
  buyer: Party,
  supplier: Party,
  lines: z.array(OrderLine).min(1, "at least one line"),
  totals: PartialTotals.optional(),
  meta: z.record(z.unknown()).optional(),
});

export type OrderLineT = z.infer<typeof OrderLine>;
export type OrderT = z.infer<typeof OrderSchema>;

export function parseOrder(input: unknown): OrderT {
  return OrderSchema.parse(input);
}
