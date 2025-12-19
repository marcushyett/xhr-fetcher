import { z } from 'zod';

// Request validation schema
export const FetchRequestSchema = z.object({
  url: z.string().url('Invalid URL provided'),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional().default('networkidle'),
  timeout: z.number().min(1000).max(360000).optional().default(60000),
  networkIdleTimeout: z.number().min(1000).max(360000).optional().default(10000),
  waitForSelector: z.string().optional(),
  additionalWaitMs: z.number().min(0).max(60000).optional().default(0),
});

export type FetchRequest = z.infer<typeof FetchRequestSchema>;

// Captured network request
export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
  timestamp: number;
}

// Captured network response
export interface CapturedResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  resourceType: string;
  timestamp: number;
  contentType?: string;
  size?: number;
}

// XHR/Fetch request with paired response
export interface XHRCapture {
  request: CapturedRequest;
  response?: CapturedResponse;
}

// JavaScript file capture
export interface ScriptCapture {
  url: string;
  content?: string;
  headers: Record<string, string>;
  size?: number;
}

// Full API response
export interface FetchResult {
  success: boolean;
  url: string;
  finalUrl: string;
  timestamp: string;
  loadTimeMs: number;
  networkIdleReached: boolean;
  html: string;
  title?: string;
  xhrRequests: XHRCapture[];
  scripts: ScriptCapture[];
  stylesheets: {
    url: string;
    content?: string;
  }[];
  documents: {
    url: string;
    content?: string;
    contentType?: string;
  }[];
  allNetworkRequests: CapturedResponse[];
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
  }[];
  console: {
    type: string;
    text: string;
    timestamp: number;
  }[];
  errors: string[];
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: string;
}
