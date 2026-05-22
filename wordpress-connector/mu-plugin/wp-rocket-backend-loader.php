<?php
/**
 * Plugin Name: WP Rocket Backend Loader
 * Description: Defines WP Rocket backend endpoint constants before normal plugins load.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$settings = get_option( 'wprbc_settings', array() );
$endpoint = isset( $settings['endpoint_url'] ) && $settings['endpoint_url'] ? untrailingslashit( esc_url_raw( $settings['endpoint_url'] ) ) : 'http://localhost:8080';

if ( ! defined( 'WP_ROCKET_SAAS_API_URL' ) ) {
	define( 'WP_ROCKET_SAAS_API_URL', trailingslashit( $endpoint ) );
}

if ( ! defined( 'WP_ROCKET_CPCSS_API_URL' ) ) {
	define( 'WP_ROCKET_CPCSS_API_URL', trailingslashit( $endpoint ) . 'api/job/' );
}

if ( ! defined( 'WP_ROCKET_EXCLUSIONS_API_URL' ) ) {
	define( 'WP_ROCKET_EXCLUSIONS_API_URL', trailingslashit( $endpoint ) . 'api/v2/' );
}
