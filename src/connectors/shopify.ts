import { parseOrder, type OrderT, type OrderLineT } from "../schemas/order.js";

type ShopifyMoney = string | number;

type ShopifyTaxLine = {
  rate?: number;
  price?: ShopifyMoney;
  title?: string;
};

type ShopifyLineItem = {
  title: string;
  quantity: number;
  price?: ShopifyMoney;
  total_discount?: ShopifyMoney;
  tax_lines?: ShopifyTaxLine[];
  sku?: string | null;
};

type ShopifyAddress = {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  zip?: string | null;
  country_code?: string | null;
};

type ShopifyCustomer = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  default_address?: ShopifyAddress | null;
};

export type ShopifyOrder = {
  id: number | string;
  name?: string | null;
  order_number?: number | string | null;
  created_at: string;
  currency: string;
  line_items: ShopifyLineItem[];
  customer?: ShopifyCustomer | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  note?: string | null;
};

type MapperOptions = {
  supplier: OrderT["supplier"];
  defaultVatRate?: number;
  currencyMinorUnit?: number;
};

function toMinor(value: ShopifyMoney | undefined, minorUnit = 2): number {
  if (value === undefined || value === null) {
    return 0;
  }

  const numeric =
    typeof value === "number"
      ? value
      : Number.parseFloat((value as string).trim());

  if (Number.isNaN(numeric)) {
    return 0;
  }

  return Math.round(numeric * 10 ** minorUnit);
}

function resolveVatRate(taxLines?: ShopifyTaxLine[], fallback?: number): number | undefined {
  if (!taxLines || taxLines.length === 0) return fallback;
  const withRate = taxLines.find((tax) => typeof tax.rate === "number");
  if (!withRate?.rate) return fallback;
  return Math.round(withRate.rate * 100);
}

function resolveVatCategory(vatRate?: number): OrderLineT["vatCategory"] | undefined {
  if (vatRate === undefined) return undefined;
  if (vatRate === 0) return "Z";
  if (vatRate === 6) return "AA";
  if (vatRate === 12) return "AE";
  return "S";
}

function buildBuyer(order: ShopifyOrder): OrderT["buyer"] {
  const source = order.shipping_address ?? order.billing_address ?? order.customer?.default_address ?? {};
  const candidates = [
    source.name,
    [source.first_name, source.last_name].filter(Boolean).join(" "),
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ")
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  const name = candidates[0] ?? "Shopify Customer";

  const address = {
    streetName: source.address1 ?? undefined,
    additionalStreetName: source.address2 ?? undefined,
    cityName: source.city ?? undefined,
    postalZone: source.zip ?? undefined,
    countryCode: source.country_code ?? undefined
  };

  const contact = {
    electronicMail: order.customer?.email ?? undefined,
    name
  };

  return {
    name,
    address,
    contact
  };
}

function buildLines(
  lineItems: ShopifyLineItem[],
  opts: { defaultVatRate?: number; minorUnit: number }
): OrderLineT[] {
  return lineItems.map((item, index) => {
    const vatRate = resolveVatRate(item.tax_lines, opts.defaultVatRate);
    const line: OrderLineT = {
      id: String(index + 1),
      description: item.title,
      quantity: item.quantity,
      unitCode: "EA",
      unitPriceMinor: toMinor(item.price, opts.minorUnit),
      discountMinor: toMinor(item.total_discount, opts.minorUnit),
      vatRate,
      vatCategory: resolveVatCategory(vatRate),
      itemName: item.sku ?? undefined
    };
    return line;
  });
}

export function shopifyToOrder(order: ShopifyOrder, options: MapperOptions): OrderT {
  const minorUnit = options.currencyMinorUnit ?? 2;
  const lines = buildLines(order.line_items, {
    defaultVatRate: options.defaultVatRate,
    minorUnit
  });

  const mapped = {
    orderNumber: order.name ?? String(order.order_number ?? order.id),
    issueDate: order.created_at,
    currency: order.currency,
    currencyMinorUnit: minorUnit,
    supplier: options.supplier,
    buyer: buildBuyer(order),
    lines,
    defaultVatRate: options.defaultVatRate,
    meta: {
      source: "shopify",
      originalOrderId: order.id,
      note: order.note ?? undefined
    }
  };

  return parseOrder(mapped);
}

export type ShopifyMapperResult = ReturnType<typeof shopifyToOrder>;
