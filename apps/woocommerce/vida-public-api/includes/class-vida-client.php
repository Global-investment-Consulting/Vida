<?php

if (!defined('ABSPATH')) {
    exit;
}

class Vida_Public_Api_Client {
    public static function build_payload(WC_Order $order, array $settings): array {
        $lines = [];
        foreach ($order->get_items() as $item) {
            $lines[] = [
                'description' => $item->get_name(),
                'quantity' => $item->get_quantity(),
                'unitPriceMinor' => (int) round($item->get_total() * 100 / max($item->get_quantity(), 1)),
                'vatRate' => self::extract_rate($item),
            ];
        }

        return [
            'externalReference' => $order->get_order_number(),
            'currency' => $order->get_currency(),
            'issueDate' => $order->get_date_created() ? $order->get_date_created()->date('c') : current_time('c'),
            'seller' => [
                'name' => get_bloginfo('name'),
            ],
            'buyer' => [
                'name' => trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name()),
                'endpoint' => [
                    'id' => $order->get_meta('_vida_buyer_endpoint_id'),
                    'scheme' => $order->get_meta('_vida_buyer_endpoint_scheme'),
                ],
                'address' => [
                    'streetName' => $order->get_billing_address_1(),
                    'additionalStreetName' => $order->get_billing_address_2(),
                    'cityName' => $order->get_billing_city(),
                    'postalZone' => $order->get_billing_postcode(),
                    'countryCode' => $order->get_billing_country(),
                ],
                'contact' => [
                    'electronicMail' => $order->get_billing_email(),
                    'telephone' => $order->get_billing_phone(),
                ],
            ],
            'lines' => $lines,
            'meta' => [
                'wordpressOrderId' => $order->get_id(),
                'siteUrl' => home_url(),
                'buyerReference' => $settings['buyer_reference'] ?? '',
            ],
        ];
    }

    public static function send_invoice(array $payload, array $settings, int $order_id): array {
        $api_url = self::determine_api_url($settings);
        $response = wp_remote_post(
            trailingslashit($api_url) . 'v0/invoices',
            [
                'headers' => [
                    'Content-Type' => 'application/json',
                    'X-Api-Key' => $settings['api_key'],
                    'Idempotency-Key' => sprintf('woo-%d', $order_id),
                ],
                'body' => wp_json_encode($payload),
                'timeout' => 15,
            ]
        );

        if (is_wp_error($response)) {
            throw new Exception($response->get_error_message());
        }

        $status = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);

        if ($status >= 300) {
            throw new Exception('Vida API error: ' . wp_remote_retrieve_body($response));
        }

        return $body ?: [];
    }

    private static function determine_api_url(array $settings): string {
        if (!empty($settings['custom_api_url'])) {
            return $settings['custom_api_url'];
        }
        return !empty($settings['test_mode']) ? 'https://staging.api.vida.build/' : 'https://api.vida.build/';
    }

    private static function extract_rate(WC_Order_Item_Product $item): ?float {
        $taxes = $item->get_taxes();
        if (empty($taxes['total'])) {
            return null;
        }
        $total = array_sum($taxes['total']);
        $line_total = (float) $item->get_total();
        if ($line_total <= 0) {
            return null;
        }
        return round(($total / $line_total) * 100, 2);
    }
}
