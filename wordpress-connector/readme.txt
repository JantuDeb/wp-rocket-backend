=== WP Rocket Backend Connector ===
Contributors: wp-rocket-backend
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later

Connects an existing WP Rocket install to a WP Rocket-compatible backend.

== Description ==

WP Rocket Backend Connector lets a WordPress site use a self-hosted or hosted compatible backend for WP Rocket SaaS-backed features.

It can:

* Create/connect an account on the backend.
* Save a site-scoped API key.
* Define WP Rocket endpoint constants.
* Inject the API key into WP Rocket requests using `credentials[wpr_key]`.
* Add an `x-api-key` header for backend requests.

== Installation ==

1. Upload and activate the plugin.
2. Go to Settings > WP Rocket Backend.
3. Enter your backend endpoint URL.
4. Click Create or Connect Account.
5. Click Test Connection.
6. Install the MU loader from `mu-plugin/wp-rocket-backend-loader.php` into `wp-content/mu-plugins/wp-rocket-backend-loader.php`.

The MU loader is recommended because WP Rocket endpoint constants should be defined before WP Rocket initializes.

== Frequently Asked Questions ==

= Can I use this with an existing WP Rocket plugin? =

Yes. This connector is designed for an existing WP Rocket installation.

= Why is there an MU plugin file? =

Normal plugins can load after WP Rocket depending on activation order. The MU loader is loaded earlier and makes endpoint constant overrides reliable.

== Changelog ==

= 0.1.0 =

Initial connector MVP.
