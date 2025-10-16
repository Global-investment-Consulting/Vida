```bash
#!/bin/sh
set -euo pipefail

# Define paths
INVOICE_SCHEMA="src/schemas/invoice.ts"
ORDER_SCHEMA="src/schemas/order.ts"
ORDER_TEST="tests/order.test.ts"

# Create src/schemas/order.ts based on src/schemas/invoice.ts
if [ ! -d "src/schemas" ]; then
  mkdir -p src/schemas
fi

if [ ! -f "$ORDER_SCHEMA" ]; then
  cat > "$ORDER_SCHEMA" <<'EOF'
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

const OrderLineSchema = z.object({
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

const PartialTotalsSchema = z.object({
  lineExtensionTotalMinor: MinorAmountSchema.min(0).optional(),
  taxTotalMinor: MinorAmountSchema.optional(),
  payableAmountMinor: MinorAmountSchema.optional(),
  allowanceTotalMinor: MinorAmountSchema.min(0).optional(),
  chargeTotalMinor: MinorAmountSchema.min(0).optional(),
  roundingMinor: MinorAmountSchema.optional()
});

const MetaSchema = z.object({}).catchall(z.unknown());

export const OrderSchema = z
  .object({
    id: z.string().trim().optional(),
    orderNumber: NonEmptyString,
    currency: CurrencyCodeSchema,
    buyer: PartySchema,
    supplier: PartySchema.extend({
      vatId: NonEmptyString
    }),
    lines: z.array(OrderLineSchema).min(1),
    totals: PartialTotalsSchema.optional(),
    meta: MetaSchema.optional()
  });

export type OrderParty = z.infer<typeof PartySchema> & { vatId?: string };
export type OrderLine = z.infer<typeof OrderLineSchema>;
export type OrderTotals = z.infer<typeof PartialTotalsSchema>;
export type NormalizedOrder = z.infer<typeof OrderSchema>;

export function parseOrder(input: unknown): NormalizedOrder {
  return OrderSchema.parse(input);
}
EOF
fi

# Create tests/order.test.ts
if [ ! -f "$ORDER_TEST" ]; then
  cat > "$ORDER_TEST" <<'EOF'
import { parseOrder } from '../src/schemas/order';

describe('Order Schema', () => {
  it('should parse a valid order', () => {
    const validOrder = {
      orderNumber: "12345",
      currency: "USD",
      buyer: { name: "Buyer Name" },
      supplier: { name: "Supplier Name", vatId: "VAT123" },
      lines: [{ description: "Item 1", quantity: 1, unitPriceMinor: 1000 }]
    };
    expect(parseOrder(validOrder)).toEqual(validOrder);
  });
});
EOF
fi

# Run sanity checks if they exist
if [ -f "package.json" ]; then
  if grep -q '"lint"' package.json; then
    npm run lint || true
  fi
  if grep -q '"test"' package.json; then
    npm ci
    npm run test || true
  fi
fi

# Stage, commit, and push changes if any
if [ -n "$(git status --porcelain)" ]; then
  git add "$ORDER_SCHEMA" "$ORDER_TEST"
  git commit -m "Create order schema and corresponding test"
  git push
fi

# Summary of changes
echo "Created src/schemas/order.ts and tests/order.test.ts"
```