import { chromium, Browser, BrowserContext, Page, Request, Response } from 'playwright';
import {
  FetchRequest,
  FetchResult,
  CapturedRequest,
  CapturedResponse,
  XHRCapture,
  ScriptCapture,
} from './types';

const isDev = process.env.NODE_ENV === 'development';

class BrowserManager {
  private browser: Browser | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.browser) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      console.log('Launching browser...');
      this.browser = await chromium.launch({
        headless: !isDev,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      console.log('Browser launched successfully');
    })();

    return this.initPromise;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.initPromise = null;
    }
  }

  async fetchPage(request: FetchRequest): Promise<FetchResult> {
    await this.initialize();

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const startTime = Date.now();
    const xhrMap = new Map<string, XHRCapture>();
    const scripts: ScriptCapture[] = [];
    const stylesheets: { url: string; content?: string }[] = [];
    const documents: { url: string; content?: string; contentType?: string }[] = [];
    const allResponses: CapturedResponse[] = [];
    const consoleMessages: { type: string; text: string; timestamp: number }[] = [];
    const errors: string[] = [];

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true,
      });

      page = await context.newPage();

      // Capture console messages
      page.on('console', (msg) => {
        consoleMessages.push({
          type: msg.type(),
          text: msg.text(),
          timestamp: Date.now(),
        });
      });

      // Capture page errors
      page.on('pageerror', (err) => {
        errors.push(err.message);
      });

      // Capture all network requests
      page.on('request', (req: Request) => {
        const resourceType = req.resourceType();
        const url = req.url();

        const capturedReq: CapturedRequest = {
          url,
          method: req.method(),
          headers: req.headers(),
          postData: req.postData() || undefined,
          resourceType,
          timestamp: Date.now(),
        };

        // Track XHR and Fetch requests
        if (resourceType === 'xhr' || resourceType === 'fetch') {
          xhrMap.set(url + req.method(), { request: capturedReq });
        }
      });

      // Capture all network responses
      page.on('response', async (res: Response) => {
        const req = res.request();
        const resourceType = req.resourceType();
        const url = res.url();
        const contentType = res.headers()['content-type'] || '';

        let body: string | undefined;
        let size: number | undefined;

        try {
          const buffer = await res.body();
          size = buffer.length;

          // Only capture text-based content
          if (
            contentType.includes('json') ||
            contentType.includes('text') ||
            contentType.includes('javascript') ||
            contentType.includes('xml') ||
            contentType.includes('html')
          ) {
            body = buffer.toString('utf-8');
          }
        } catch {
          // Response body not available (e.g., streaming or already consumed)
        }

        const capturedRes: CapturedResponse = {
          url,
          status: res.status(),
          statusText: res.statusText(),
          headers: res.headers(),
          body,
          resourceType,
          timestamp: Date.now(),
          contentType,
          size,
        };

        allResponses.push(capturedRes);

        // Update XHR map with response
        if (resourceType === 'xhr' || resourceType === 'fetch') {
          const key = url + req.method();
          const existing = xhrMap.get(key);
          if (existing) {
            existing.response = capturedRes;
          } else {
            xhrMap.set(key, {
              request: {
                url,
                method: req.method(),
                headers: req.headers(),
                postData: req.postData() || undefined,
                resourceType,
                timestamp: Date.now(),
              },
              response: capturedRes,
            });
          }
        }

        // Capture scripts
        if (resourceType === 'script') {
          scripts.push({
            url,
            content: body,
            headers: res.headers(),
            size,
          });
        }

        // Capture stylesheets
        if (resourceType === 'stylesheet') {
          stylesheets.push({
            url,
            content: body,
          });
        }

        // Capture document requests (HTML pages, iframes)
        if (resourceType === 'document' && url !== request.url) {
          documents.push({
            url,
            content: body,
            contentType,
          });
        }
      });

      // Navigate to the page with fallback for networkidle timeout
      let networkIdleReached = true;
      let response;

      if (request.waitUntil === 'networkidle') {
        // Try networkidle first with the configured timeout
        try {
          response = await page.goto(request.url, {
            waitUntil: 'networkidle',
            timeout: request.networkIdleTimeout,
          });
        } catch (err) {
          // If networkidle times out, fallback to domcontentloaded
          if (err instanceof Error && err.name === 'TimeoutError') {
            console.log(`Network idle timeout after ${request.networkIdleTimeout}ms, falling back to domcontentloaded`);
            networkIdleReached = false;

            // Page may already be partially loaded, just wait a bit more for any pending requests
            try {
              await page.waitForLoadState('domcontentloaded', { timeout: request.timeout - request.networkIdleTimeout });
            } catch {
              // Ignore if domcontentloaded also times out - we'll use whatever we have
            }
          } else {
            throw err;
          }
        }
      } else {
        // Use the specified waitUntil directly
        response = await page.goto(request.url, {
          waitUntil: request.waitUntil,
          timeout: request.timeout,
        });
      }

      // For fallback case, response may be null but page is still usable
      if (!response && networkIdleReached) {
        throw new Error('No response received from page');
      }

      // Wait for optional selector
      if (request.waitForSelector) {
        try {
          await page.waitForSelector(request.waitForSelector, {
            timeout: Math.min(request.timeout, 30000),
          });
        } catch {
          // Selector not found, continue anyway
          console.log(`Selector "${request.waitForSelector}" not found within timeout`);
        }
      }

      // Additional wait if specified
      if (request.additionalWaitMs > 0) {
        await page.waitForTimeout(request.additionalWaitMs);
      }

      // Get page content
      const html = await page.content();
      const title = await page.title();
      const finalUrl = page.url();

      // Get cookies
      const cookies = await context.cookies();

      const loadTimeMs = Date.now() - startTime;

      return {
        success: true,
        url: request.url,
        finalUrl,
        timestamp: new Date().toISOString(),
        loadTimeMs,
        networkIdleReached,
        html,
        title,
        xhrRequests: Array.from(xhrMap.values()),
        scripts,
        stylesheets,
        documents,
        allNetworkRequests: allResponses,
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
        })),
        console: consoleMessages,
        errors,
      };
    } finally {
      if (page) await page.close();
      if (context) await context.close();
    }
  }
}

// Singleton instance
export const browserManager = new BrowserManager();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down browser...');
  await browserManager.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down browser...');
  await browserManager.close();
  process.exit(0);
});
