## Vida WooCommerce Plugin

WordPress plugin under `vida-public-api/` that forwards completed WooCommerce orders to the Vida public API.

### Install

1. Copy `apps/woocommerce/vida-public-api` into your site's `wp-content/plugins` directory.
2. Activate “Vida WooCommerce Bridge” from the WordPress admin.
3. Open **WooCommerce → Vida Public API** and configure:
   - API key (same as `X-Api-Key`)
   - Test mode (toggle between staging/production Vida endpoints)
   - Optional custom API URL and buyer reference defaults

### Behavior

- Hooks into `woocommerce_order_status_completed`.
- Builds a BIS3-friendly payload (buyer contact/address, order lines, totals).
- Sends it to `/v0/invoices` with `Idempotency-Key=woo-{order_id}`.
- Stores the Vida response as order meta (`_vida_invoice_sent`) to avoid duplicates.

### Custom Buyer Reference

Merchants can add two custom order meta fields:

- `_vida_buyer_endpoint_id`
- `_vida_buyer_endpoint_scheme`

When present, the Peppol endpoint is forwarded to Vida for direct B2G deliveries.
