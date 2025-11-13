<?php

if (!defined('ABSPATH')) {
    exit;
}

class Vida_Public_Api_Settings {
    public static function init(): void {
        add_action('admin_menu', [__CLASS__, 'register_menu']);
        add_action('admin_init', [__CLASS__, 'register_settings']);
    }

    public static function register_menu(): void {
        add_submenu_page(
            'woocommerce',
            'Vida Public API',
            'Vida Public API',
            'manage_woocommerce',
            'vida-public-api',
            [__CLASS__, 'render_page']
        );
    }

    public static function register_settings(): void {
        register_setting('vida_public_api', 'vida_public_api_settings');

        add_settings_section(
            'vida_public_api_main',
            __('API Settings', 'vida-public-api'),
            '__return_false',
            'vida-public-api'
        );

        add_settings_field(
            'vida_api_key',
            __('API Key', 'vida-public-api'),
            [__CLASS__, 'render_input'],
            'vida-public-api',
            'vida_public_api_main',
            [
                'label_for' => 'vida_api_key',
                'type' => 'password',
                'option' => 'api_key',
            ]
        );

        add_settings_field(
            'vida_test_mode',
            __('Test mode', 'vida-public-api'),
            [__CLASS__, 'render_checkbox'],
            'vida-public-api',
            'vida_public_api_main',
            [
                'label_for' => 'vida_test_mode',
                'option' => 'test_mode',
            ]
        );

        add_settings_field(
            'vida_custom_api_url',
            __('Custom API URL (optional)', 'vida-public-api'),
            [__CLASS__, 'render_input'],
            'vida-public-api',
            'vida_public_api_main',
            [
                'label_for' => 'vida_custom_api_url',
                'type' => 'text',
                'option' => 'custom_api_url',
            ]
        );

        add_settings_field(
            'vida_buyer_reference',
            __('Default Buyer Reference', 'vida-public-api'),
            [__CLASS__, 'render_input'],
            'vida-public-api',
            'vida_public_api_main',
            [
                'label_for' => 'vida_buyer_reference',
                'type' => 'text',
                'option' => 'buyer_reference',
            ]
        );
    }

    public static function render_input(array $args): void {
        $options = self::get_options();
        $value = isset($options[$args['option']]) ? esc_attr($options[$args['option']]) : '';
        printf(
            '<input type="%s" id="%s" name="vida_public_api_settings[%s]" value="%s" class="regular-text" />',
            esc_attr($args['type'] ?? 'text'),
            esc_attr($args['label_for']),
            esc_attr($args['option']),
            $value
        );
    }

    public static function render_checkbox(array $args): void {
        $options = self::get_options();
        $checked = !empty($options[$args['option']]);
        printf(
            '<input type="checkbox" id="%s" name="vida_public_api_settings[%s]" value="1" %s />',
            esc_attr($args['label_for']),
            esc_attr($args['option']),
            checked($checked, true, false)
        );
    }

    public static function render_page(): void {
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Vida Public API', 'vida-public-api'); ?></h1>
            <form method="post" action="options.php">
                <?php
                settings_fields('vida_public_api');
                do_settings_sections('vida-public-api');
                submit_button();
                ?>
            </form>
        </div>
        <?php
    }

    public static function get_options(): array {
        $defaults = [
            'api_key' => '',
            'test_mode' => false,
            'custom_api_url' => '',
            'buyer_reference' => '',
        ];
        $options = get_option('vida_public_api_settings', []);
        return wp_parse_args($options, $defaults);
    }
}
