// Analytics and tracking domain blocklist
const ANALYTICS_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'facebook.net',
  'facebook.com/tr',
  'connect.facebook.net',
  'analytics.facebook.com',
  'segment.io',
  'segment.com',
  'cdn.segment.com',
  'api.segment.io',
  'mixpanel.com',
  'hotjar.com',
  'hotjar.io',
  'clarity.ms',
  'newrelic.com',
  'nr-data.net',
  'sentry.io',
  'sentry-cdn.com',
  'fullstory.com',
  'amplitude.com',
  'heapanalytics.com',
  'heap-api.com',
  'optimizely.com',
  'cdn.optimizely.com',
  'intercom.io',
  'intercomcdn.com',
  'crisp.chat',
  'drift.com',
  'hubspot.com',
  'hs-analytics.net',
  'hsforms.com',
  'mxpnl.com',
  'branch.io',
  'app.link',
  'appsflyer.com',
  'adjust.com',
  'kochava.com',
  'bugsnag.com',
  'logrocket.com',
  'logrocket.io',
  'smartlook.com',
  'mouseflow.com',
  'luckyorange.com',
  'crazyegg.com',
  'clicktale.net',
  'quantserve.com',
  'scorecardresearch.com',
  'chartbeat.com',
  'parsely.com',
  'pingdom.net',
  'speedcurve.com',
  'datadoghq.com',
  'rum.browser-intake-datadoghq.com',
  'browser-intake-datadoghq.com',
  'onesignal.com',
  'pusher.com',
  'pubnub.com',
  'adsrvr.org',
  'adroll.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'amazon-adsystem.com',
  'ads-twitter.com',
  'ads.linkedin.com',
  'snap.licdn.com',
  'px.ads.linkedin.com',
  'bat.bing.com',
  'clarity.ms',
  'mc.yandex.ru',
  'top-fwz1.mail.ru',
  'vk.com/rtrg',
  'tiktok.com/i18n/pixel',
  'analytics.tiktok.com',
];

// Path patterns that indicate analytics/tracking
const ANALYTICS_PATH_PATTERNS = [
  /\/collect\b/i,
  /\/track\b/i,
  /\/beacon\b/i,
  /\/pixel\b/i,
  /\/analytics\b/i,
  /\/__analytics/i,
  /\/log\b/i,
  /\/telemetry\b/i,
  /\/metrics\b/i,
  /\/events?\b/i,
  /\/ping\b/i,
  /\/heartbeat\b/i,
  /\/v1\/batch\b/i,  // Segment
  /\/v1\/t\b/i,      // Segment track
  /\/v1\/p\b/i,      // Segment page
  /\/v1\/i\b/i,      // Segment identify
  /\/r\/collect\b/i, // Google Analytics
  /\/j\/collect\b/i, // Google Analytics
  /\/g\/collect\b/i, // Google Analytics 4
  /\/mp\/collect\b/i,// Google Measurement Protocol
  /\.gif\?/i,        // Tracking pixels
  /\.png\?.*utm/i,   // Tracking pixels with UTM
  /\/tr\?/i,         // Facebook pixel
  /\/xd_arbiter/i,   // Facebook
  /\/sdk\.js/i,      // Various SDKs (usually tracking)
  /\/gtag\//i,       // Google Tag
  /\/gtm\//i,        // Google Tag Manager
];

// Resource types that are never core data
const EXCLUDED_RESOURCE_TYPES = [
  'image',
  'media',
  'font',
  'stylesheet',
  'manifest',
  'preflight',
];

/**
 * Check if a URL belongs to a known analytics/tracking domain
 */
export function isAnalyticsDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ANALYTICS_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Check if a URL path matches analytics patterns
 */
export function isAnalyticsPath(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const pathAndQuery = urlObj.pathname + urlObj.search;
    return ANALYTICS_PATH_PATTERNS.some(pattern => pattern.test(pathAndQuery));
  } catch {
    return false;
  }
}

/**
 * Check if a response body is too small or empty to be meaningful data
 */
export function isTrivialPayload(body?: string): boolean {
  if (!body) return true;
  if (body.length < 50) return true;

  // Check if it's just an empty response
  const trimmed = body.trim();
  if (trimmed === '' || trimmed === '{}' || trimmed === '[]' || trimmed === 'null') {
    return true;
  }

  // Check for common tracking response patterns
  if (/^(ok|success|1|true|"ok"|"success")$/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Check if a request is likely an analytics/tracking request
 */
export function isAnalyticsRequest(url: string, body?: string): boolean {
  if (isAnalyticsDomain(url)) return true;
  if (isAnalyticsPath(url)) return true;
  return false;
}

/**
 * Determine if a request is likely fetching core application data
 */
export function isCoreDataRequest(
  url: string,
  contentType: string,
  resourceType: string,
  body?: string
): boolean {
  // Exclude certain resource types
  if (EXCLUDED_RESOURCE_TYPES.includes(resourceType)) {
    return false;
  }

  // Must be XHR or fetch
  if (resourceType !== 'xhr' && resourceType !== 'fetch') {
    return false;
  }

  // Filter out analytics
  if (isAnalyticsRequest(url, body)) {
    return false;
  }

  // Must have a meaningful content type for data
  const ct = contentType.toLowerCase();
  const isDataContentType =
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('html') ||
    ct.includes('text/plain');

  if (!isDataContentType) {
    return false;
  }

  // Filter out trivial payloads
  if (isTrivialPayload(body)) {
    return false;
  }

  return true;
}

/**
 * Get the data category from content type
 */
export function getContentCategory(contentType: string): 'json' | 'xml' | 'html' | 'text' | 'unknown' {
  const ct = contentType.toLowerCase();
  if (ct.includes('json')) return 'json';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('html')) return 'html';
  if (ct.includes('text')) return 'text';
  return 'unknown';
}
