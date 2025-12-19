import express, { Request, Response, NextFunction } from 'express';
import { FetchRequestSchema, FetchResult, ErrorResponse } from './types';
import { browserManager } from './browser';
import { ZodError } from 'zod';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

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

  // Pre-initialize browser in background
  browserManager.initialize().catch((err) => {
    console.error('Failed to initialize browser:', err);
  });
});
