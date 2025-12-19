/**
 * API Detection and Analysis Module
 *
 * Analyzes web pages to detect how they fetch data:
 * - JSON APIs
 * - GraphQL APIs
 * - XML APIs
 * - HTML fragment APIs
 * - Next.js embedded data (__NEXT_DATA__)
 * - Nuxt.js embedded data (__NUXT__)
 * - Server-side rendered (SSR) only
 */

import { XMLParser } from 'fast-xml-parser';
import { isCoreDataRequest, getContentCategory } from './filters';
import { inferJsonSchema, createSample, safeJsonParse, JSONSchema } from './schema-generator';
import { XHRCapture } from './types';

export type DataSourceCategory =
  | 'json-api'
  | 'graphql'
  | 'xml-api'
  | 'html-api'
  | 'nextjs-embedded'
  | 'nuxt-embedded'
  | 'ssr-only';

export type APICategory = 'json-api' | 'graphql' | 'xml-api' | 'html-api';

export interface DetectedAPI {
  url: string;
  method: string;
  category: APICategory;
  schema: JSONSchema;
  sample: unknown;
  responseHeaders: Record<string, string>;
  requestHeaders: Record<string, string>;
  postData?: string;
}

export interface EmbeddedData {
  category: 'nextjs-embedded' | 'nuxt-embedded';
  data: unknown;
  schema: JSONSchema;
}

export interface AnalyzeResult {
  success: boolean;
  url: string;
  finalUrl: string;
  timestamp: string;
  loadTimeMs: number;
  networkIdleReached: boolean;

  // Detection result
  primaryDataSource: DataSourceCategory;
  confidence: 'high' | 'medium' | 'low';

  // Core APIs (filtered, no analytics)
  detectedAPIs: DetectedAPI[];

  // Embedded data (Next.js, Nuxt)
  embeddedData?: EmbeddedData;

  // Only included if primaryDataSource is 'ssr-only'
  html?: string;
  title?: string;
}

/**
 * Check if JSON data looks like a GraphQL response
 */
function isGraphQLResponse(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  // GraphQL responses have 'data' and optionally 'errors'
  if ('data' in obj || 'errors' in obj) {
    return true;
  }

  // Check for __typename which is common in GraphQL
  const hasTypename = JSON.stringify(data).includes('__typename');
  if (hasTypename) return true;

  return false;
}

/**
 * Check if URL looks like a GraphQL endpoint
 */
function isGraphQLEndpoint(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('/graphql') || lowerUrl.includes('/gql');
}

/**
 * Extract __NEXT_DATA__ from HTML
 */
function extractNextData(html: string): unknown | null {
  // Look for <script id="__NEXT_DATA__" type="application/json">
  const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (match && match[1]) {
    return safeJsonParse(match[1]);
  }
  return null;
}

/**
 * Extract __NUXT__ data from HTML
 */
function extractNuxtData(html: string): unknown | null {
  // Look for window.__NUXT__= or __NUXT__=
  // Nuxt 2: window.__NUXT__={...}
  // Nuxt 3: <script id="__NUXT_DATA__" type="application/json">

  // Try Nuxt 3 style first
  const nuxt3Match = html.match(/<script\s+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nuxt3Match && nuxt3Match[1]) {
    return safeJsonParse(nuxt3Match[1]);
  }

  // Try Nuxt 2 style
  const nuxt2Match = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i);
  if (nuxt2Match && nuxt2Match[1]) {
    // This is JavaScript, not JSON, so we need to be careful
    // Try to extract just the object literal
    try {
      // Simple approach: use Function constructor (safe since we're server-side)
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return ${nuxt2Match[1]}`);
      return fn();
    } catch {
      return null;
    }
  }

  // Alternative pattern
  const altMatch = html.match(/__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
  if (altMatch && altMatch[1]) {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return ${altMatch[1]}`);
      return fn();
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Convert XML to JSON
 */
function xmlToJson(xmlString: string): unknown | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      parseTagValue: true,
    });
    return parser.parse(xmlString);
  } catch {
    return null;
  }
}

/**
 * Process HTML fragment to extract useful data
 */
function processHtmlFragment(html: string): { html: string; textContent: string } {
  // Simple text extraction - remove tags
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    html: html.length > 1000 ? html.substring(0, 1000) + '...' : html,
    textContent: textContent.length > 500 ? textContent.substring(0, 500) + '...' : textContent,
  };
}

/**
 * Analyze XHR requests and detect API patterns
 */
function analyzeXHRRequests(xhrRequests: XHRCapture[]): DetectedAPI[] {
  const apis: DetectedAPI[] = [];

  for (const xhr of xhrRequests) {
    const { request, response } = xhr;
    if (!response?.body) continue;

    const contentType = response.contentType || '';
    const url = response.url;

    // Check if this is a core data request (not analytics)
    if (!isCoreDataRequest(url, contentType, request.resourceType, response.body)) {
      continue;
    }

    const category = getContentCategory(contentType);
    let data: unknown = null;
    let apiCategory: APICategory;

    if (category === 'json') {
      data = safeJsonParse(response.body);
      if (data === null) continue;

      // Check if it's GraphQL
      if (isGraphQLEndpoint(url) || isGraphQLResponse(data)) {
        apiCategory = 'graphql';
      } else {
        apiCategory = 'json-api';
      }
    } else if (category === 'xml') {
      data = xmlToJson(response.body);
      if (data === null) continue;
      apiCategory = 'xml-api';
    } else if (category === 'html') {
      data = processHtmlFragment(response.body);
      apiCategory = 'html-api';
    } else {
      // Skip unknown types
      continue;
    }

    apis.push({
      url: request.url,
      method: request.method,
      category: apiCategory,
      schema: inferJsonSchema(data),
      sample: createSample(data),
      responseHeaders: response.headers,
      requestHeaders: request.headers,
      postData: request.postData,
    });
  }

  return apis;
}

/**
 * Determine primary data source and confidence
 */
function determinePrimarySource(
  apis: DetectedAPI[],
  embeddedData: EmbeddedData | undefined
): { source: DataSourceCategory; confidence: 'high' | 'medium' | 'low' } {
  // If we have embedded Next.js data with pageProps, that's the primary source
  if (embeddedData?.category === 'nextjs-embedded') {
    const data = embeddedData.data as Record<string, unknown>;
    const props = data?.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;
    if (pageProps && Object.keys(pageProps).length > 0) {
      return { source: 'nextjs-embedded', confidence: 'high' };
    }
  }

  // If we have embedded Nuxt data
  if (embeddedData?.category === 'nuxt-embedded') {
    return { source: 'nuxt-embedded', confidence: 'high' };
  }

  // Count API types
  const counts: Record<APICategory, number> = {
    'json-api': 0,
    'graphql': 0,
    'xml-api': 0,
    'html-api': 0,
  };

  for (const api of apis) {
    counts[api.category]++;
  }

  // Find the dominant API type
  const total = apis.length;
  if (total === 0) {
    if (embeddedData) {
      return { source: embeddedData.category, confidence: 'medium' };
    }
    return { source: 'ssr-only', confidence: 'medium' };
  }

  // Prioritize GraphQL if present (usually the main data source)
  if (counts['graphql'] > 0) {
    return { source: 'graphql', confidence: counts['graphql'] > 1 ? 'high' : 'medium' };
  }

  // Otherwise, use the most common type
  let maxType: APICategory = 'json-api';
  let maxCount = 0;
  for (const [type, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      maxType = type as APICategory;
    }
  }

  const confidence = maxCount >= 3 ? 'high' : maxCount >= 1 ? 'medium' : 'low';
  return { source: maxType, confidence };
}

/**
 * Main analysis function
 */
export function analyzePageData(
  html: string,
  xhrRequests: XHRCapture[],
  title?: string
): {
  detectedAPIs: DetectedAPI[];
  embeddedData?: EmbeddedData;
  primaryDataSource: DataSourceCategory;
  confidence: 'high' | 'medium' | 'low';
  includeHtml: boolean;
} {
  // Check for embedded framework data
  let embeddedData: EmbeddedData | undefined;

  const nextData = extractNextData(html);
  if (nextData) {
    embeddedData = {
      category: 'nextjs-embedded',
      data: nextData,
      schema: inferJsonSchema(nextData),
    };
  }

  if (!embeddedData) {
    const nuxtData = extractNuxtData(html);
    if (nuxtData) {
      embeddedData = {
        category: 'nuxt-embedded',
        data: nuxtData,
        schema: inferJsonSchema(nuxtData),
      };
    }
  }

  // Analyze XHR requests
  const detectedAPIs = analyzeXHRRequests(xhrRequests);

  // Determine primary data source
  const { source: primaryDataSource, confidence } = determinePrimarySource(detectedAPIs, embeddedData);

  // Only include HTML if it's SSR-only
  const includeHtml = primaryDataSource === 'ssr-only';

  return {
    detectedAPIs,
    embeddedData,
    primaryDataSource,
    confidence,
    includeHtml,
  };
}
