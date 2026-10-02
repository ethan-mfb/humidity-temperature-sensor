import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { StaticServer } from "./staticServer";
import { startStaticServer } from "./staticServer";
import { BUILDS_DIR, VERSIONS } from "./versions";

const SERVICE_WORKER_TIMEOUT_MS = 15_000;

const text = {
  heading: "Hello, World!",
  offlineReady: "Ready to work offline.",
  updateAvailable: "A new version is available.",
};

const buildOf = (version: string): string => join(BUILDS_DIR, version);
const versionLabel = (version: string): string => `v${version}`;

async function openOfflineReady(
  page: Page,
  server: StaticServer,
): Promise<void> {
  await page.goto(server.url);
  await expect(page.getByText(text.offlineReady)).toBeVisible({
    timeout: SERVICE_WORKER_TIMEOUT_MS,
  });
  await page.getByRole("button", { name: "OK" }).click();
}

test.describe("hts PWA", () => {
  let server: StaticServer;

  test.beforeEach(async () => {
    server = await startStaticServer(buildOf(VERSIONS.current));
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("says hello and shows its version", async ({ page }) => {
    await page.goto(server.url);
    await expect(
      page.getByRole("heading", { level: 1, name: text.heading }),
    ).toBeVisible();
    await expect(page.getByText(versionLabel(VERSIONS.current))).toBeVisible();
  });

  test("meets the browser's install criteria", async ({ page, context }) => {
    await openOfflineReady(page, server);
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send(
      "Page.getInstallabilityErrors",
    );
    expect(installabilityErrors).toEqual([]);
  });

  test("loads from the cache when the server is down", async ({ page }) => {
    await openOfflineReady(page, server);
    server.setDown(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: text.heading }),
    ).toBeVisible();
  });

  const acceptUpdate = async (page: Page): Promise<void> => {
    server.deploy(buildOf(VERSIONS.next));
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect(page.getByText(text.updateAvailable)).toBeVisible({
      timeout: SERVICE_WORKER_TIMEOUT_MS,
    });
    await expect(page.getByText(versionLabel(VERSIONS.current))).toBeVisible();
    await page.getByRole("button", { name: "Update" }).click();
    await expect(page.getByText(versionLabel(VERSIONS.next))).toBeVisible({
      timeout: SERVICE_WORKER_TIMEOUT_MS,
    });
  };

  test("updates a tab opened before the app was cached", async ({ page }) => {
    await openOfflineReady(page, server);
    await acceptUpdate(page);
  });

  test("updates a tab the service worker already controls", async ({
    page,
  }) => {
    await openOfflineReady(page, server);
    await page.reload();
    await acceptUpdate(page);
  });
});
