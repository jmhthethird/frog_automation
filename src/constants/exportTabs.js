'use strict';

/**
 * The default export-tabs string used by the backend when no explicit value is provided.
 * Used by the route and crawler; the UI derives its own default from EXPORT_TABS_DATA.
 * Includes every :All flag and every individual tab option for each category.
 */
const DEFAULT_EXPORT_TABS =
  'AMP:All,AMP:Non-200 Response,AMP:Missing Non-AMP Return Link,' +
  'AMP:Missing Canonical to Non-AMP,AMP:Non-Indexable Canonical,AMP:Indexable,' +
  'AMP:Non-Indexable,AMP:Missing <html amp> Tag,AMP:Missing/Invalid <!doctype html> Tag,' +
  'AMP:Missing <head> Tag,AMP:Missing <body> Tag,AMP:Missing Canonical,' +
  'AMP:Missing/Invalid <meta charset> Tag,AMP:Missing/Invalid <meta viewport> Tag,' +
  'AMP:Missing/Invalid AMP Script,AMP:Missing/Invalid AMP Boilerplate,' +
  'AMP:Contains Disallowed HTML,AMP:Other Validation Errors,' +
  'Analytics:All,Analytics:Sessions Above 0,Analytics:Bounce Rate Above 70%,' +
  'Analytics:No GA Data,Analytics:Non-Indexable with GA Data,Analytics:Orphan URLs,' +
  'Canonicals:All,Canonicals:Contains Canonical,Canonicals:Self Referencing,' +
  'Canonicals:Canonicalised,Canonicals:Missing,Canonicals:Multiple,' +
  'Canonicals:Non-Indexable Canonical,Canonicals:Multiple Conflicting,' +
  'Canonicals:Canonical Is Relative,Canonicals:Unlinked,Canonicals:Outside <head>,' +
  'Change Detection:All,Change Detection:Word Count,Change Detection:Crawl Depth,' +
  'Change Detection:Indexability,Change Detection:Page Titles,Change Detection:H1,' +
  'Change Detection:Meta Description,Change Detection:Inlinks,' +
  'Change Detection:Unique Inlinks,Change Detection:Internal Outlinks,' +
  'Change Detection:Unique Internal Outlinks,Change Detection:External Outlinks,' +
  'Change Detection:Unique External Outlinks,' +
  'Change Detection:Structured Data Unique Types,Change Detection:Content,' +
  'Content:All,Content:Spelling Errors,Content:Grammar Errors,' +
  'Content:Near Duplicates,Content:Exact Duplicates,Content:Low Content Pages,' +
  'Content:Readability Difficult,Content:Readability Very Difficult,' +
  'Content:Lorem Ipsum Placeholder,Content:Soft 404 Pages,' +
  'Custom Extraction:All,Custom Search:All,' +
  'Directives:All,Directives:Index,Directives:Noindex,Directives:Follow,' +
  'Directives:Nofollow,Directives:None,Directives:NoArchive,Directives:NoSnippet,' +
  'Directives:Max-Snippet,Directives:Max-Image-Preview,Directives:Max-Video-Preview,' +
  'Directives:NoODP,Directives:NoYDIR,Directives:NoImageIndex,Directives:NoTranslate,' +
  'Directives:Unavailable_After,Directives:Refresh,Directives:Outside <head>,' +
  'External:All,External:HTML,External:JavaScript,External:CSS,External:Images,' +
  'External:PDF,External:Flash,External:Other,External:Unknown,' +
  'H1:All,H1:Missing,H1:Duplicate,H1:Over X Characters,H1:Multiple,' +
  'H1:Alt Text in H1,H1:Non-Sequential,' +
  'H2:All,H2:Missing,H2:Duplicate,H2:Over X Characters,H2:Multiple,H2:Non-Sequential,' +
  'Hreflang:All,Hreflang:Contains hreflang,Hreflang:Non-200 hreflang URLs,' +
  'Hreflang:Unlinked hreflang URLs,Hreflang:Missing Return Links,' +
  'Hreflang:Inconsistent Language & Region Return Links,' +
  'Hreflang:Non-Canonical Return Links,Hreflang:Noindex Return Links,' +
  'Hreflang:Incorrect Language & Region Codes,Hreflang:Multiple Entries,' +
  'Hreflang:Missing Self Reference,Hreflang:Not Using Canonical,' +
  'Hreflang:Missing X-Default,Hreflang:Missing,Hreflang:Outside <head>,' +
  'Images:All,Images:Over X KB,Images:Missing Alt Text,Images:Missing Alt Attribute,' +
  'Images:Alt Text Over X Characters,Images:Background Images,' +
  'Images:Incorrectly Sized Images,Images:Missing Size Attributes,' +
  'Internal:All,Internal:HTML,Internal:JavaScript,Internal:CSS,Internal:Images,' +
  'Internal:PDF,Internal:Flash,Internal:Other,Internal:Unknown,' +
  'JavaScript:All,JavaScript:Uses Old AJAX Crawling Scheme URLs,' +
  'JavaScript:Uses Old AJAX Crawling Scheme Meta Fragment Tag,' +
  'JavaScript:Page Title Only in Rendered HTML,JavaScript:Page Title Updated by JavaScript,' +
  'JavaScript:H1 Only in Rendered HTML,JavaScript:H1 Updated by JavaScript,' +
  'JavaScript:Meta Description Only in Rendered HTML,' +
  'JavaScript:Meta Description Updated by JavaScript,' +
  'JavaScript:Canonical Only in Rendered HTML,JavaScript:Canonical Mismatch,' +
  'JavaScript:Noindex Only in Original HTML,JavaScript:Nofollow Only in Original HTML,' +
  'JavaScript:Contains JavaScript Links,JavaScript:Contains JavaScript Content,' +
  'JavaScript:Pages with Blocked Resources,JavaScript:Pages with JavaScript Errors,' +
  'JavaScript:Pages with JavaScript Warnings,JavaScript:Pages with Chrome Issues,' +
  'Link Metrics:All,' +
  'Links:All,Links:Pages Without Internal Outlinks,Links:Internal Nofollow Outlinks,' +
  'Links:Internal Outlinks With No Anchor Text,' +
  'Links:Non-Descriptive Anchor Text In Internal Outlinks,' +
  'Links:Pages With High External Outlinks,Links:Pages With High Internal Outlinks,' +
  'Links:Follow & Nofollow Internal Inlinks To Page,Links:Internal Nofollow Inlinks Only,' +
  'Links:Pages With High Crawl Depth,Links:Outlinks To Localhost,' +
  'Links:Non-Indexable Page Inlinks Only,' +
  'Meta Description:All,Meta Description:Missing,Meta Description:Duplicate,' +
  'Meta Description:Over X Characters,Meta Description:Below X Characters,' +
  'Meta Description:Over X Pixels,Meta Description:Below X Pixels,' +
  'Meta Description:Multiple,Meta Description:Outside <head>,' +
  'Meta Keywords:All,Meta Keywords:Missing,Meta Keywords:Duplicate,Meta Keywords:Multiple,' +
  'Page Titles:All,Page Titles:Missing,Page Titles:Duplicate,' +
  'Page Titles:Over X Characters,Page Titles:Below X Characters,' +
  'Page Titles:Over X Pixels,Page Titles:Below X Pixels,' +
  'Page Titles:Same as H1,Page Titles:Multiple,Page Titles:Outside <head>,' +
  'PageSpeed:All,PageSpeed:Eliminate Render-Blocking Resources,' +
  'PageSpeed:Minify CSS,PageSpeed:Minify JavaScript,' +
  'PageSpeed:Reduce Unused CSS,PageSpeed:Reduce Unused JavaScript,' +
  'PageSpeed:Enable Text Compression,' +
  'PageSpeed:Preconnect to Required Origins,' +
  'PageSpeed:Reduce Server Response Times (TTFB),PageSpeed:Avoid Multiple Page Redirects,' +
  'PageSpeed:Avoid Excessive DOM Size,PageSpeed:Reduce JavaScript Execution Time,' +
  'PageSpeed:Serve Static Assets with an Efficient Cache Policy,' +
  'PageSpeed:Minimize Main-Thread Work,' +
  'PageSpeed:Ensure Text Remains Visible During Webfont Load,' +
  'PageSpeed:Avoid Large Layout Shifts,' +
  'PageSpeed:Avoid Serving Legacy JavaScript to Modern Browsers,PageSpeed:Request Errors,' +
  'Pagination:All,Pagination:Contains Pagination,Pagination:First Page,' +
  'Pagination:Paginated 2+ Pages,Pagination:Pagination URL Not in Anchor Tag,' +
  'Pagination:Non-200 Pagination URLs,Pagination:Unlinked Pagination URLs,' +
  'Pagination:Non-Indexable,Pagination:Multiple Pagination URLs,' +
  'Pagination:Pagination Loop,Pagination:Sequence Error,' +
  'Response Codes:All,Response Codes:Blocked by Robots.txt,' +
  'Response Codes:Blocked Resource,Response Codes:No Response,' +
  'Response Codes:Success (2xx),Response Codes:Redirection (3xx),' +
  'Response Codes:Redirection (JavaScript),Response Codes:Redirection (Meta Refresh),' +
  'Response Codes:Client Error (4xx),Response Codes:Server Error (5xx),' +
  'Response Codes:Internal All,Response Codes:Internal Blocked by Robots.txt,' +
  'Response Codes:Internal Blocked Resource,Response Codes:Internal No Response,' +
  'Response Codes:Internal Success (2xx),Response Codes:Internal Redirection (3xx),' +
  'Response Codes:Internal Redirection (JavaScript),' +
  'Response Codes:Internal Redirection (Meta Refresh),' +
  'Response Codes:Internal Redirect Chain,Response Codes:Internal Redirect Loop,' +
  'Response Codes:Internal Client Error (4xx),Response Codes:Internal Server Error (5xx),' +
  'Response Codes:External All,Response Codes:External Blocked by Robots.txt,' +
  'Response Codes:External Blocked Resource,Response Codes:External No Response,' +
  'Response Codes:External Success (2xx),Response Codes:External Redirection (3xx),' +
  'Response Codes:External Redirection (JavaScript),' +
  'Response Codes:External Redirection (Meta Refresh),' +
  'Response Codes:External Client Error (4xx),Response Codes:External Server Error (5xx),' +
  'Search Console:All,Search Console:Clicks Above 0,' +
  'Search Console:No Search Analytics Data,' +
  'Search Console:Non-Indexable with Search Analytics Data,Search Console:Orphan URLs,' +
  'Search Console:URL is Not on Google,Search Console:Indexable URL Not Indexed,' +
  'Search Console:URL is on Google But Has Issues,' +
  'Search Console:User-Declared Canonical Not Selected,' +
  'Search Console:Page is Not Mobile Friendly,Search Console:AMP URL Invalid,' +
  'Search Console:Rich Result Invalid,' +
  'Security:All,Security:HTTP URLs,Security:HTTPS URLs,Security:Mixed Content,' +
  'Security:Form URL Insecure,Security:Form on HTTP URL,Security:Unsafe Cross-Origin Links,' +
  'Security:Missing HSTS Header,Security:Bad Content Type,' +
  'Security:Missing X-Content-Type-Options Header,Security:Missing X-Frame-Options Header,' +
  'Security:Protocol-Relative Resource Links,' +
  'Security:Missing Content-Security-Policy Header,' +
  'Security:Missing Secure Referrer-Policy Header,' +
  'Sitemaps:All,Sitemaps:URLs in Sitemap,Sitemaps:URLs not in Sitemap,' +
  'Sitemaps:Orphan URLs,Sitemaps:Non-Indexable URLs in Sitemap,' +
  'Sitemaps:URLs in Multiple Sitemaps,Sitemaps:XML Sitemap with over 50k URLs,' +
  'Sitemaps:XML Sitemap over 50MB,' +
  'Structured Data:All,Structured Data:Contains Structured Data,Structured Data:Missing,' +
  'Structured Data:Validation Errors,Structured Data:Validation Warnings,' +
  'Structured Data:Parse Errors,Structured Data:Microdata URLs,' +
  'Structured Data:JSON-LD URLs,Structured Data:RDFa URLs,' +
  'URL:All,URL:Non ASCII Characters,URL:Underscores,URL:Uppercase,URL:Parameters,' +
  'URL:Over X Characters,URL:Multiple Slashes,URL:Repetitive Path,URL:Contains Space,' +
  'URL:Broken Bookmark,URL:Internal Search,URL:GA Tracking Parameters,' +
  'Validation:All,Validation:Invalid HTML Elements in Head,' +
  'Validation:<head> Not First In <html> Element,Validation:Missing <head> Tag,' +
  'Validation:Multiple <head> Tags,Validation:Missing <body> Tag,' +
  'Validation:Multiple <body> Tags,Validation:HTML Document Over 15MB,' +
  'Validation:<body> Element Preceding <html>';

module.exports = { DEFAULT_EXPORT_TABS };
