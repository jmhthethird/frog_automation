'use strict';

/**
 * The default export-tabs string used when no explicit value is provided.
 * This is the single source of truth shared by the route, crawler, and UI.
 */
const DEFAULT_EXPORT_TABS =
  'AMP:All,Analytics:All,Canonicals:All,Change Detection:All,Content:All,' +
  'Custom Extraction:All,Directives:All,External:All,H1:All,H2:All,' +
  'Hreflang:All,Images:All,Internal:All,JavaScript:All,Link Metrics:All,' +
  'Links:All,Meta Description:All,Meta Keywords:All,Page Titles:All,' +
  'PageSpeed:All,Pagination:All,Response Codes:All,Search Console:All,' +
  'Security:All,Sitemaps:All,Structured Data:All,URL:All,Validation:All';

module.exports = { DEFAULT_EXPORT_TABS };
