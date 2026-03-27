// badge.js
// Sets the badgeCssUri variable on window
// This file is loaded as an external script to comply with CSP

/**
 * Sets the badgeCssUri variable on window.
 * @param {string} uri - The URI to the badge CSS file.
 */
function setBadgeCssUri(uri) {
    window.badgeCssUri = uri;
}

// Automatically applies badgeCssUri if present in the data-badge-css-uri attribute
document.addEventListener('DOMContentLoaded', function() {
    const badgeCssUri = document.body.getAttribute('data-badge-css-uri');
    if (badgeCssUri) {
        setBadgeCssUri(badgeCssUri);
    }
});
