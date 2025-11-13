export type ShopifyAddress = {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  zip?: string;
  country_code?: string;
  phone?: string;
};

export type ShopifyLineItem = {
  name: string;
  quantity: number;
  price: string;
  total_discount?: string;
  tax_lines?: Array<{ price: string }>;
};

export type ShopifyOrder = {
  id: number;
  name?: string;
  currency?: string;
  email?: string;
  created_at?: string;
  closed_at?: string;
  billing_address?: ShopifyAddress;
  shipping_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
};

export type InvoiceSubmission = {
  externalReference?: string;
  currency: string;
  issueDate: string;
  dueDate?: string;
  seller: {
    name: string;
    endpoint?: { scheme?: string; id?: string };
  };
  buyer: {
    name: string;
    endpoint?: { scheme?: string; id?: string };
    address?: {
      streetName?: string;
      additionalStreetName?: string;
      cityName?: string;
      postalZone?: string;
      countryCode?: string;
    };
    contact?: { electronicMail?: string; telephone?: string };
  };
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceMinor: number;
    discountMinor?: number;
    vatRate?: number;
  }>;
  meta?: Record<string, unknown>;
};

const DEFAULT_SUPPLIER = {
  name: process.env.VIDA_SELLER_NAME || "Vida Shopify Seller",
  endpoint: {
    scheme: process.env.VIDA_SELLER_ENDPOINT_SCHEME,
    id: process.env.VIDA_SELLER_ENDPOINT_ID
  }
};

function toMinor(value: string | number | undefined): number {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }
  if (!value) {
    return 0;
  }
  return Math.round(Number.parseFloat(value) * 100);
}

function mapLine(item: ShopifyLineItem) {
  const priceMinor = toMinor(item.price);
  const discountMinor = toMinor(item.total_discount);
  return {
    description: item.name,
    quantity: item.quantity,
    unitPriceMinor: priceMinor,
    discountMinor,
    vatRate: item.tax_lines && item.tax_lines[0] ? Number.parseFloat(item.tax_lines[0].price ?? "0") : undefined
  };
}

function mapBuyerAddress(address?: ShopifyAddress) {
  if (!address) {
    return undefined;
  }
  return {
    streetName: address.address1,
    additionalStreetName: address.address2,
    cityName: address.city,
    postalZone: address.zip,
    countryCode: address.country_code
  };
}

export function orderToInvoice(order: ShopifyOrder): InvoiceSubmission {
  const issueDate = order.created_at ?? new Date().toISOString();
  return {
    externalReference: order.name ?? String(order.id),
    currency: order.currency ?? "EUR",
    issueDate,
    seller: DEFAULT_SUPPLIER,
    buyer: {
      name: order.billing_address?.name ?? order.shipping_address?.name ?? "Shopify Buyer",
      address: mapBuyerAddress(order.billing_address ?? order.shipping_address),
      contact: {
        electronicMail: order.email,
        telephone: order.billing_address?.phone
      }
    },
    lines: order.line_items?.map((item) => mapLine(item)) ?? [],
    meta: {
      shopifyOrderId: order.id,
      shopifyName: order.name
    }
  };
}
