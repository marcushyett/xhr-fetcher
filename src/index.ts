import express, { Request, Response, NextFunction } from 'express';
import { FetchRequestSchema, AnalyzeRequestSchema, FetchResult, ErrorResponse } from './types';
import { browserManager } from './browser';
import { analyzePageData, AnalyzeResult } from './analyzer';
import { ZodError } from 'zod';

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.API_KEY;

app.use(express.json({ limit: '10mb' }));

// API key authentication middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  // Skip auth for health check
  if (req.path === '/health') {
    return next();
  }

  // If no API_KEY is configured, allow all requests
  if (!apiKey) {
    return next();
  }

  // Check for API key in Authorization header (Bearer token) or x-api-key header
  const authHeader = req.headers.authorization;
  const xApiKey = req.headers['x-api-key'];

  const providedKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : xApiKey;

  if (providedKey !== apiKey) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      details: 'Invalid or missing API key',
    });
    return;
  }

  next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main fetch endpoint
app.post('/fetch', async (req: Request, res: Response<FetchResult | ErrorResponse>) => {
  const startTime = Date.now();

  try {
    // Validate request body
    const fetchRequest = FetchRequestSchema.parse(req.body);

    console.log(`Fetching: ${fetchRequest.url}`);

    // Fetch the page
    const result = await browserManager.fetchPage(fetchRequest);

    console.log(`Completed: ${fetchRequest.url} in ${Date.now() - startTime}ms`);

    res.json(result);
  } catch (error) {
    console.error('Fetch error:', error);

    if (error instanceof ZodError) {
      res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch page',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET version for simple testing
app.get('/fetch', async (req: Request, res: Response<FetchResult | ErrorResponse>) => {
  const url = req.query.url as string;

  if (!url) {
    res.status(400).json({
      success: false,
      error: 'Missing required parameter: url',
    });
    return;
  }

  try {
    // Parse optional query parameters
    const networkIdleTimeout = req.query.networkIdleTimeout
      ? parseInt(req.query.networkIdleTimeout as string, 10)
      : undefined;
    const timeout = req.query.timeout
      ? parseInt(req.query.timeout as string, 10)
      : undefined;
    const additionalWaitMs = req.query.additionalWaitMs
      ? parseInt(req.query.additionalWaitMs as string, 10)
      : undefined;
    const waitForSelector = req.query.waitForSelector as string | undefined;
    const waitUntil = req.query.waitUntil as 'load' | 'domcontentloaded' | 'networkidle' | undefined;

    const fetchRequest = FetchRequestSchema.parse({
      url,
      networkIdleTimeout,
      timeout,
      additionalWaitMs,
      waitForSelector,
      waitUntil,
    });

    console.log(`Fetching (GET): ${fetchRequest.url} (networkIdleTimeout: ${fetchRequest.networkIdleTimeout}ms)`);

    const result = await browserManager.fetchPage(fetchRequest);

    console.log(`Completed: ${fetchRequest.url}`);

    res.json(result);
  } catch (error) {
    console.error('Fetch error:', error);

    if (error instanceof ZodError) {
      res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch page',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Analyze endpoint - POST
app.post('/analyze', async (req: Request, res: Response<AnalyzeResult | ErrorResponse>) => {
  const startTime = Date.now();

  try {
    const analyzeRequest = AnalyzeRequestSchema.parse(req.body);

    console.log(`Analyzing: ${analyzeRequest.url}`);

    // First fetch the page using existing browser manager
    const fetchResult = await browserManager.fetchPage({
      url: analyzeRequest.url,
      waitUntil: 'networkidle',
      timeout: analyzeRequest.timeout,
      networkIdleTimeout: analyzeRequest.networkIdleTimeout,
      waitForSelector: analyzeRequest.waitForSelector,
      additionalWaitMs: analyzeRequest.additionalWaitMs,
    });

    // Analyze the fetched data
    const analysis = analyzePageData(
      fetchResult.html,
      fetchResult.xhrRequests,
      fetchResult.title
    );

    const result: AnalyzeResult = {
      success: true,
      url: analyzeRequest.url,
      finalUrl: fetchResult.finalUrl,
      timestamp: new Date().toISOString(),
      loadTimeMs: Date.now() - startTime,
      networkIdleReached: fetchResult.networkIdleReached,
      primaryDataSource: analysis.primaryDataSource,
      confidence: analysis.confidence,
      detectedAPIs: analysis.detectedAPIs,
      embeddedData: analysis.embeddedData,
      // Only include HTML for SSR-only pages
      html: analysis.includeHtml ? fetchResult.html : undefined,
      title: fetchResult.title,
    };

    console.log(`Analyzed: ${analyzeRequest.url} - ${analysis.primaryDataSource} (${analysis.confidence})`);

    res.json(result);
  } catch (error) {
    console.error('Analyze error:', error);

    if (error instanceof ZodError) {
      res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to analyze page',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Analyze endpoint - GET
app.get('/analyze', async (req: Request, res: Response<AnalyzeResult | ErrorResponse>) => {
  const url = req.query.url as string;

  if (!url) {
    res.status(400).json({
      success: false,
      error: 'Missing required parameter: url',
    });
    return;
  }

  const startTime = Date.now();

  try {
    const networkIdleTimeout = req.query.networkIdleTimeout
      ? parseInt(req.query.networkIdleTimeout as string, 10)
      : undefined;
    const timeout = req.query.timeout
      ? parseInt(req.query.timeout as string, 10)
      : undefined;
    const additionalWaitMs = req.query.additionalWaitMs
      ? parseInt(req.query.additionalWaitMs as string, 10)
      : undefined;
    const waitForSelector = req.query.waitForSelector as string | undefined;

    const analyzeRequest = AnalyzeRequestSchema.parse({
      url,
      networkIdleTimeout,
      timeout,
      additionalWaitMs,
      waitForSelector,
    });

    console.log(`Analyzing (GET): ${analyzeRequest.url}`);

    // First fetch the page
    const fetchResult = await browserManager.fetchPage({
      url: analyzeRequest.url,
      waitUntil: 'networkidle',
      timeout: analyzeRequest.timeout,
      networkIdleTimeout: analyzeRequest.networkIdleTimeout,
      waitForSelector: analyzeRequest.waitForSelector,
      additionalWaitMs: analyzeRequest.additionalWaitMs,
    });

    // Analyze the fetched data
    const analysis = analyzePageData(
      fetchResult.html,
      fetchResult.xhrRequests,
      fetchResult.title
    );

    const result: AnalyzeResult = {
      success: true,
      url: analyzeRequest.url,
      finalUrl: fetchResult.finalUrl,
      timestamp: new Date().toISOString(),
      loadTimeMs: Date.now() - startTime,
      networkIdleReached: fetchResult.networkIdleReached,
      primaryDataSource: analysis.primaryDataSource,
      confidence: analysis.confidence,
      detectedAPIs: analysis.detectedAPIs,
      embeddedData: analysis.embeddedData,
      html: analysis.includeHtml ? fetchResult.html : undefined,
      title: fetchResult.title,
    };

    console.log(`Analyzed: ${analyzeRequest.url} - ${analysis.primaryDataSource} (${analysis.confidence})`);

    res.json(result);
  } catch (error) {
    console.error('Analyze error:', error);

    if (error instanceof ZodError) {
      res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to analyze page',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response<ErrorResponse>, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: err.message,
  });
});

// Start server
app.listen(port, () => {
  console.log(`XHR Fetcher API running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`API key auth: ${apiKey ? 'enabled' : 'disabled'}`);

  // Pre-initialize browser in background
  browserManager.initialize().catch((err) => {
    console.error('Failed to initialize browser:', err);
  });
});
