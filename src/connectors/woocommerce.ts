import { parseOrder, type OrderLineT, type OrderT } from "../schemas/order.js";

type WooMoney = string | number;

type WooTaxLine = {
  rate_percent?: WooMoney;
  total?: WooMoney;
  subtotal?: WooMoney;
};

type WooLineItem = {
  id?: number;
  name: string;
  product_id?: number;
  sku?: string | null;
  price?: WooMoney;
  subtotal?: WooMoney;
  subtotal_tax?: WooMoney;
  total?: WooMoney;
  total_tax?: WooMoney;
  quantity: number;
  taxes?: WooTaxLine[];
};

type WooAddress = {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
  email?: string | null;
};

export type WooOrder = {
  id: number | string;
  number?: string | null;
  order_key?: string | null;
  date_created: string;
  currency: string;
  line_items: WooLineItem[];
  billing?: WooAddress | null;
  shipping?: WooAddress | null;
  customer_note?: string | null;
  status?: string | null;
};

type MapperOptions = {
  supplier: OrderT["supplier"];
  defaultVatRate?: number;
  currencyMinorUnit?: number;
};

function toMinor(value: WooMoney | undefined, minorUnit = 2): number {
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

function toNumber(value: WooMoney | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat((value as string).trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

function resolveVatRate(taxes: WooTaxLine[] | undefined, fallback?: number): number | undefined {
  if (!taxes || taxes.length === 0) return fallback;

  for (const tax of taxes) {
    const percent = toNumber(tax.rate_percent);
    if (percent !== undefined) {
      return Math.round(percent);
    }
  }

  for (const tax of taxes) {
    const total = toNumber(tax.total ?? tax.subtotal);
    const base = toNumber(tax.subtotal);
    if (total !== undefined && base && base > 0) {
      return Math.round((total / base) * 100);
    }
  }

  return fallback;
}

function resolveVatCategory(vatRate?: number): OrderLineT["vatCategory"] | undefined {
  if (vatRate === undefined) return undefined;
  if (vatRate === 0) return "Z";
  if (vatRate === 6) return "AA";
  if (vatRate === 12) return "AE";
  return "S";
}

function buildBuyer(order: WooOrder): OrderT["buyer"] {
  const source = order.shipping ?? order.billing ?? {};
  const nameCandidates = [
    [source.first_name, source.last_name].filter(Boolean).join(" ").trim(),
    source.company ?? "",
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  const name = nameCandidates[0] || "WooCommerce Customer";

  const address = {
    streetName: source.address_1 ?? undefined,
    additionalStreetName: source.address_2 ?? undefined,
    cityName: source.city ?? undefined,
    postalZone: source.postcode ?? undefined,
    countryCode: source.country ?? undefined
  };

  const contact = {
    electronicMail: source.email ?? undefined,
    name
  };

  return {
    name,
    address,
    contact
  };
}

function calculateDiscountMinor(item: WooLineItem, minorUnit: number): number {
  const subtotal = toNumber(item.subtotal);
  const total = toNumber(item.total);
  if (subtotal === undefined || total === undefined) {
    return 0;
  }

  const discount = subtotal - total;
  return discount > 0 ? toMinor(discount, minorUnit) : 0;
}

function buildLines(items: WooLineItem[], opts: { defaultVatRate?: number; minorUnit: number }): OrderLineT[] {
  return items.map((item, index) => {
    const vatRate = resolveVatRate(item.taxes, opts.defaultVatRate);
    let unitPriceValue = toNumber(item.price);
    if (unitPriceValue === undefined && item.quantity > 0) {
      const subtotalValue = toNumber(item.subtotal);
      if (subtotalValue !== undefined) {
        unitPriceValue = subtotalValue / item.quantity;
      }
    }
    if (unitPriceValue === undefined) {
      unitPriceValue = toNumber(item.total);
    }
    const unitPriceMinor = toMinor(unitPriceValue, opts.minorUnit);

    const discountMinor = calculateDiscountMinor(item, opts.minorUnit);

    return {
      id: String(item.id ?? index + 1),
      description: item.name,
      quantity: item.quantity,
      unitCode: "EA",
      unitPriceMinor,
      discountMinor,
      vatRate,
      vatCategory: resolveVatCategory(vatRate),
      itemName: item.sku ?? undefined
    };
  });
}

export function wooToOrder(order: WooOrder, options: MapperOptions): OrderT {
  const minorUnit = options.currencyMinorUnit ?? 2;
  const lines = buildLines(order.line_items, {
    defaultVatRate: options.defaultVatRate,
    minorUnit
  });

  const orderNumber = order.number ?? String(order.id);

  const mapped = {
    orderNumber,
    issueDate: order.date_created,
    currency: order.currency,
    currencyMinorUnit: minorUnit,
    supplier: options.supplier,
    buyer: buildBuyer(order),
    lines,
    defaultVatRate: options.defaultVatRate,
    meta: {
      source: "woocommerce",
      originalOrderId: order.id,
      status: order.status ?? undefined,
      note: order.customer_note ?? undefined
    }
  };

  return parseOrder(mapped);
}

export type WooMapperResult = ReturnType<typeof wooToOrder>;
