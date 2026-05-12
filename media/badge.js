/**
 * Lightweight badge bootstrap loaded as an external script to comply with CSP.
 */

/**
 * Sets the badgeCssUri variable on window.
 * @param {string} uri The URI to the badge CSS file.
 */
function setBadgeCssUri(uri) {
    window.badgeCssUri = uri;
}

// Automatically apply badgeCssUri when available in the data-badge-css-uri attribute.
document.addEventListener('DOMContentLoaded', function() {
    const badgeCssUri = document.body.getAttribute('data-badge-css-uri');
    if (badgeCssUri) {
        setBadgeCssUri(badgeCssUri);
    }
});
