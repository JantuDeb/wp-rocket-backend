<?php
/**
 * Plugin Name: WP Rocket Backend Connector
 * Description: Connects an existing WP Rocket install to a self-hosted WP Rocket-compatible backend.
 * Version: 0.1.0
 * Author: WP Rocket Backend
 * Requires PHP: 7.4
 * Requires at least: 6.0
 * Text Domain: wp-rocket-backend-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'WPRBC_VERSION', '0.1.0' );
define( 'WPRBC_OPTION', 'wprbc_settings' );

wprbc_define_endpoint_constants();

add_action( 'admin_menu', 'wprbc_admin_menu' );
add_action( 'admin_init', 'wprbc_register_settings' );
add_action( 'admin_post_wprbc_signup', 'wprbc_handle_signup' );
add_action( 'admin_post_wprbc_test_connection', 'wprbc_handle_test_connection' );
add_filter( 'http_request_args', 'wprbc_inject_api_key_into_wp_rocket_requests', 20, 2 );
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'wprbc_plugin_action_links' );

function wprbc_defaults() {
	return array(
		'endpoint_url'      => 'http://localhost:8080',
		'account_email'     => get_option( 'admin_email' ),
		'site_url'          => home_url( '/' ),
		'api_key'           => '',
		'last_status'       => '',
		'last_status_time'  => '',
		'connected_account' => '',
		'connected_site'    => '',
	);
}

function wprbc_settings() {
	$settings = get_option( WPRBC_OPTION, array() );

	return wp_parse_args( is_array( $settings ) ? $settings : array(), wprbc_defaults() );
}

function wprbc_update_settings( array $settings ) {
	update_option( WPRBC_OPTION, wp_parse_args( $settings, wprbc_settings() ), false );
}

function wprbc_endpoint_url() {
	$settings = wprbc_settings();

	return untrailingslashit( esc_url_raw( $settings['endpoint_url'] ) );
}

function wprbc_define_endpoint_constants() {
	$base = wprbc_endpoint_url();

	if ( ! defined( 'WP_ROCKET_SAAS_API_URL' ) ) {
		define( 'WP_ROCKET_SAAS_API_URL', trailingslashit( $base ) );
	}

	if ( ! defined( 'WP_ROCKET_CPCSS_API_URL' ) ) {
		define( 'WP_ROCKET_CPCSS_API_URL', trailingslashit( $base ) . 'api/job/' );
	}

	if ( ! defined( 'WP_ROCKET_EXCLUSIONS_API_URL' ) ) {
		define( 'WP_ROCKET_EXCLUSIONS_API_URL', trailingslashit( $base ) . 'api/v2/' );
	}
}

function wprbc_admin_menu() {
	add_options_page(
		__( 'WP Rocket Backend', 'wp-rocket-backend-connector' ),
		__( 'WP Rocket Backend', 'wp-rocket-backend-connector' ),
		'manage_options',
		'wp-rocket-backend-connector',
		'wprbc_render_settings_page'
	);
}

function wprbc_register_settings() {
	register_setting(
		'wprbc_settings',
		WPRBC_OPTION,
		array(
			'type'              => 'array',
			'sanitize_callback' => 'wprbc_sanitize_settings',
			'default'           => wprbc_defaults(),
		)
	);
}

function wprbc_sanitize_settings( $value ) {
	$current = wprbc_settings();
	$value   = is_array( $value ) ? $value : array();

	return array(
		'endpoint_url'      => isset( $value['endpoint_url'] ) ? untrailingslashit( esc_url_raw( $value['endpoint_url'] ) ) : $current['endpoint_url'],
		'account_email'     => isset( $value['account_email'] ) ? sanitize_email( $value['account_email'] ) : $current['account_email'],
		'site_url'          => isset( $value['site_url'] ) ? esc_url_raw( $value['site_url'] ) : $current['site_url'],
		'api_key'           => isset( $value['api_key'] ) ? sanitize_text_field( $value['api_key'] ) : $current['api_key'],
		'last_status'       => $current['last_status'],
		'last_status_time'  => $current['last_status_time'],
		'connected_account' => $current['connected_account'],
		'connected_site'    => $current['connected_site'],
	);
}

function wprbc_render_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$settings = wprbc_settings();
	$status   = $settings['last_status'] ? $settings['last_status'] : __( 'Not tested yet.', 'wp-rocket-backend-connector' );
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'WP Rocket Backend Connector', 'wp-rocket-backend-connector' ); ?></h1>

		<?php if ( isset( $_GET['wprbc_message'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php echo esc_html( wp_unslash( $_GET['wprbc_message'] ) ); ?></p></div>
		<?php endif; ?>

		<form method="post" action="options.php">
			<?php settings_fields( 'wprbc_settings' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="wprbc-endpoint"><?php esc_html_e( 'Backend endpoint', 'wp-rocket-backend-connector' ); ?></label></th>
					<td><input class="regular-text code" id="wprbc-endpoint" name="<?php echo esc_attr( WPRBC_OPTION ); ?>[endpoint_url]" value="<?php echo esc_attr( $settings['endpoint_url'] ); ?>" type="url"></td>
				</tr>
				<tr>
					<th scope="row"><label for="wprbc-email"><?php esc_html_e( 'Account email', 'wp-rocket-backend-connector' ); ?></label></th>
					<td><input class="regular-text" id="wprbc-email" name="<?php echo esc_attr( WPRBC_OPTION ); ?>[account_email]" value="<?php echo esc_attr( $settings['account_email'] ); ?>" type="email"></td>
				</tr>
				<tr>
					<th scope="row"><label for="wprbc-site-url"><?php esc_html_e( 'Site URL', 'wp-rocket-backend-connector' ); ?></label></th>
					<td><input class="regular-text code" id="wprbc-site-url" name="<?php echo esc_attr( WPRBC_OPTION ); ?>[site_url]" value="<?php echo esc_attr( $settings['site_url'] ); ?>" type="url"></td>
				</tr>
				<tr>
					<th scope="row"><label for="wprbc-api-key"><?php esc_html_e( 'API key', 'wp-rocket-backend-connector' ); ?></label></th>
					<td>
						<input class="regular-text code" id="wprbc-api-key" name="<?php echo esc_attr( WPRBC_OPTION ); ?>[api_key]" value="<?php echo esc_attr( $settings['api_key'] ); ?>" type="password" autocomplete="off">
						<p class="description"><?php esc_html_e( 'Stored in WordPress options. Treat it like a password.', 'wp-rocket-backend-connector' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Connection status', 'wp-rocket-backend-connector' ); ?></th>
					<td>
						<p><strong><?php echo esc_html( $status ); ?></strong></p>
						<?php if ( $settings['last_status_time'] ) : ?>
							<p class="description"><?php echo esc_html( $settings['last_status_time'] ); ?></p>
						<?php endif; ?>
					</td>
				</tr>
			</table>
			<?php submit_button( __( 'Save Settings', 'wp-rocket-backend-connector' ) ); ?>
		</form>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline-block;margin-right:8px;">
			<?php wp_nonce_field( 'wprbc_signup' ); ?>
			<input type="hidden" name="action" value="wprbc_signup">
			<?php submit_button( __( 'Create or Connect Account', 'wp-rocket-backend-connector' ), 'secondary', 'submit', false ); ?>
		</form>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline-block;">
			<?php wp_nonce_field( 'wprbc_test_connection' ); ?>
			<input type="hidden" name="action" value="wprbc_test_connection">
			<?php submit_button( __( 'Test Connection', 'wp-rocket-backend-connector' ), 'secondary', 'submit', false ); ?>
		</form>

		<p>
			<a href="<?php echo esc_url( trailingslashit( wprbc_endpoint_url() ) . 'dashboard' ); ?>" target="_blank" rel="noreferrer"><?php esc_html_e( 'Open backend dashboard', 'wp-rocket-backend-connector' ); ?></a>
		</p>
	</div>
	<?php
}

function wprbc_handle_signup() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Insufficient permissions.', 'wp-rocket-backend-connector' ) );
	}

	check_admin_referer( 'wprbc_signup' );

	$settings = wprbc_settings();
	$response = wprbc_remote_json(
		'/account/signup',
		array(
			'email'    => $settings['account_email'],
			'site_url' => $settings['site_url'],
		)
	);

	if ( is_wp_error( $response ) ) {
		wprbc_save_status( $response->get_error_message() );
		wprbc_redirect( __( 'Connection failed. Check the status message.', 'wp-rocket-backend-connector' ) );
	}

	$settings['api_key']           = isset( $response['api_key']['key'] ) ? sanitize_text_field( $response['api_key']['key'] ) : $settings['api_key'];
	$settings['connected_account'] = isset( $response['account']['id'] ) ? sanitize_text_field( $response['account']['id'] ) : '';
	$settings['connected_site']    = isset( $response['site']['id'] ) ? sanitize_text_field( $response['site']['id'] ) : '';
	$settings['last_status']       = __( 'Connected.', 'wp-rocket-backend-connector' );
	$settings['last_status_time']  = current_time( 'mysql' );
	wprbc_update_settings( $settings );
	wprbc_redirect( __( 'Account connected and API key saved.', 'wp-rocket-backend-connector' ) );
}

function wprbc_handle_test_connection() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Insufficient permissions.', 'wp-rocket-backend-connector' ) );
	}

	check_admin_referer( 'wprbc_test_connection' );

	$response = wprbc_remote_json( '/account/me', null, 'GET' );

	if ( is_wp_error( $response ) ) {
		wprbc_save_status( $response->get_error_message() );
		wprbc_redirect( __( 'Connection failed. Check the status message.', 'wp-rocket-backend-connector' ) );
	}

	wprbc_save_status( __( 'Connection OK.', 'wp-rocket-backend-connector' ) );
	wprbc_redirect( __( 'Connection test passed.', 'wp-rocket-backend-connector' ) );
}

function wprbc_remote_json( $path, $body = null, $method = 'POST' ) {
	$settings = wprbc_settings();
	$args     = array(
		'method'  => $method,
		'timeout' => 20,
		'headers' => array(
			'accept' => 'application/json',
		),
	);

	if ( $settings['api_key'] ) {
		$args['headers']['x-api-key'] = $settings['api_key'];
	}

	if ( null !== $body ) {
		$args['headers']['content-type'] = 'application/json';
		$args['body']                    = wp_json_encode( $body );
	}

	$response = wp_remote_request( trailingslashit( wprbc_endpoint_url() ) . ltrim( $path, '/' ), $args );

	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$code = wp_remote_retrieve_response_code( $response );
	$data = json_decode( wp_remote_retrieve_body( $response ), true );

	if ( $code < 200 || $code >= 300 ) {
		$message = is_array( $data ) && isset( $data['message'] ) ? $data['message'] : sprintf( 'HTTP %d', $code );

		return new WP_Error( 'wprbc_http_error', $message );
	}

	return is_array( $data ) ? $data : array();
}

function wprbc_save_status( $message ) {
	$settings                     = wprbc_settings();
	$settings['last_status']      = sanitize_text_field( $message );
	$settings['last_status_time'] = current_time( 'mysql' );
	wprbc_update_settings( $settings );
}

function wprbc_redirect( $message ) {
	wp_safe_redirect(
		add_query_arg(
			array(
				'page'          => 'wp-rocket-backend-connector',
				'wprbc_message' => rawurlencode( $message ),
			),
			admin_url( 'options-general.php' )
		)
	);
	exit;
}

function wprbc_inject_api_key_into_wp_rocket_requests( $args, $url ) {
	$settings = wprbc_settings();
	$api_key  = $settings['api_key'];

	if ( ! $api_key || ! wprbc_is_backend_request( $url ) ) {
		return $args;
	}

	if ( empty( $args['headers'] ) || ! is_array( $args['headers'] ) ) {
		$args['headers'] = array();
	}

	$args['headers']['x-api-key'] = $api_key;

	if ( isset( $args['body'] ) && is_array( $args['body'] ) ) {
		$args['body']['credentials']['wpr_key']   = $api_key;
		$args['body']['credentials']['wpr_email'] = $settings['account_email'];
		return $args;
	}

	if ( isset( $args['body'] ) && is_string( $args['body'] ) ) {
		$trimmed = trim( $args['body'] );

		if ( '' !== $trimmed && '{' === $trimmed[0] ) {
			$body = json_decode( $args['body'], true );

			if ( is_array( $body ) ) {
				$body['credentials']['wpr_key']   = $api_key;
				$body['credentials']['wpr_email'] = $settings['account_email'];
				$args['body']                     = wp_json_encode( $body );
			}

			return $args;
		}

		parse_str( $args['body'], $body );

		if ( is_array( $body ) ) {
			$body['credentials']['wpr_key']   = $api_key;
			$body['credentials']['wpr_email'] = $settings['account_email'];
			$args['body']                     = http_build_query( $body, '', '&' );
		}
	}

	return $args;
}

function wprbc_is_backend_request( $url ) {
	$base = trailingslashit( wprbc_endpoint_url() );

	return 0 === strpos( $url, $base );
}

function wprbc_plugin_action_links( $links ) {
	array_unshift(
		$links,
		sprintf(
			'<a href="%s">%s</a>',
			esc_url( admin_url( 'options-general.php?page=wp-rocket-backend-connector' ) ),
			esc_html__( 'Settings', 'wp-rocket-backend-connector' )
		)
	);

	return $links;
}
