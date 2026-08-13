import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { assertAllowedNavigation, DEFAULT_XHS_ORIGINS } from "@social-agent/xhs-adapter";
import type { PrefillPage } from "@social-agent/xhs-adapter";

export interface BrowserSession {
  page: PrefillPage;
  currentUrl(): string;
  guardViolations(): readonly string[];
  close(): Promise<void>;
}

interface GuardState {
  violations: string[];
}

function selectorError(): Error {
  return new Error("PREFILL_SELECTOR_NOT_FOUND");
}

async function firstVisible(page: Page, selectors: readonly string[]) {
  for (const selector of selectors) {
    const candidate = page.locator(selector).first();
    if (await candidate.count() > 0 && await candidate.isVisible()) return candidate;
  }
  throw selectorError();
}

async function installNavigationGuard(
  context: BrowserContext,
  page: Page,
  state: GuardState,
  allowedOrigins: readonly string[],
  allowFixture: boolean,
): Promise<void> {
  const check = (url: string): boolean => {
    const decision = assertAllowedNavigation(url, allowedOrigins, allowFixture);
    if (!decision.allowed) {
      state.violations.push(decision.reason);
      return false;
    }
    return true;
  };

  const routeHandler = async (route: Route) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      if (request.method() !== "GET") {
        state.violations.push("NAVIGATION_METHOD_BLOCKED");
        await route.abort();
        return;
      }
      if (!check(request.url())) {
        await route.abort();
        return;
      }
    }
    await route.continue();
  };
  await page.route("**/*", routeHandler);

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) check(frame.url());
  });
  context.on("page", (popup) => {
    if (popup !== page) {
      state.violations.push("POPUP_BLOCKED");
      void popup.close();
    }
  });
}

function wrapPage(page: Page, state: GuardState): PrefillPage {
  async function first(selectors: readonly string[]) {
    return firstVisible(page, selectors);
  }

  return {
    async hasSelector(selectors) {
      for (const selector of selectors) {
        const candidate = page.locator(selector).first();
        if (await candidate.count() > 0 && await candidate.isVisible()) return true;
      }
      return false;
    },
    async hasText(values) {
      const body = await page.locator("body").innerText();
      return values.some((value) => body.includes(value));
    },
    async setInputFiles(selectors, paths) {
      await (await first(selectors)).setInputFiles([...paths]);
    },
    async fill(selectors, value) {
      await (await first(selectors)).fill(value);
    },
    async readValue(selectors) {
      return (await first(selectors)).inputValue();
    },
    async count(selectors) {
      for (const selector of selectors) {
        const candidate = page.locator(selector).first();
        if (await candidate.count() === 0 || !await candidate.isVisible()) continue;
        const text = (await candidate.textContent())?.trim() ?? "";
        if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
        return await page.locator(selector).count();
      }
      return 0;
    },
    async screenshot(path) {
      await page.screenshot({ path, fullPage: false });
    },
    guardViolations: () => [...state.violations],
  };
}

function sessionFrom(context: BrowserContext, page: Page, state: GuardState): BrowserSession {
  const safePage = wrapPage(page, state);
  return {
    page: safePage,
    currentUrl: () => page.url(),
    guardViolations: () => [...state.violations],
    close: () => context.close(),
  };
}

export async function launchFixtureSession(fixturePath: string): Promise<BrowserSession> {
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const state: GuardState = { violations: [] };
  await installNavigationGuard(context, page, state, DEFAULT_XHS_ORIGINS, true);
  await page.goto(pathToFileURL(fixturePath).href);
  return {
    ...sessionFrom(context, page, state),
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

export async function launchPersistentSession(input: {
  profileDir: string;
  editorUrl: string;
  allowedOrigins?: readonly string[];
}): Promise<BrowserSession> {
  await mkdir(input.profileDir, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(input.profileDir, { headless: false });
  const existingPages = context.pages();
  const page = existingPages[0] ?? await context.newPage();
  await Promise.all(existingPages.slice(1).map((extra) => extra.close()));
  const state: GuardState = { violations: [] };
  await installNavigationGuard(context, page, state, input.allowedOrigins ?? DEFAULT_XHS_ORIGINS, false);
  await page.goto(input.editorUrl);
  return sessionFrom(context, page, state);
}
