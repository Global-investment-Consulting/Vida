<?php
/**
 * Plugin Name: Vida WooCommerce Bridge
 * Description: Sends paid WooCommerce orders to Vida's public API (Peppol-ready invoices).
 * Version: 0.1.0
 * Author: Vida Engineering
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/includes/class-vida-settings.php';
require_once __DIR__ . '/includes/class-vida-client.php';

class Vida_Public_Api_Plugin {
    public static function init(): void {
        add_action('init', [__CLASS__, 'bootstrap']);
        add_action('woocommerce_order_status_completed', [__CLASS__, 'handle_order']);
    }

    public static function bootstrap(): void {
        Vida_Public_Api_Settings::init();
    }

    public static function handle_order(int $order_id): void {
        if (get_post_meta($order_id, '_vida_invoice_sent', true)) {
            return;
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }

        $settings = Vida_Public_Api_Settings::get_options();
        if (empty($settings['api_key'])) {
            return;
        }

        try {
            $payload = Vida_Public_Api_Client::build_payload($order, $settings);
            $response = Vida_Public_Api_Client::send_invoice($payload, $settings, $order_id);
            update_post_meta($order_id, '_vida_invoice_sent', wp_json_encode($response));
        } catch (Exception $e) {
            error_log('[Vida Public API] Invoice send failed: ' . $e->getMessage());
        }
    }
}

Vida_Public_Api_Plugin::init();
