import { expect, test } from "@playwright/test";

const PUBLIC_ORIGIN = "https://repoditor.vercel.app/";
const GITHUB_URL = "https://github.com/Yoruxyv/RepoDitor";
const POLICIES = [
  { name: "Security", hash: "security" },
  { name: "Data & Privacy", hash: "privacy" },
  { name: "Terms", hash: "terms" },
] as const;

test("public footer and policy deep links survive refresh without browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  expect((await page.goto("/"))?.status()).toBe(200);
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("Save contents stay local and are not persisted.");
  await expect(footer.getByRole("link")).toHaveCount(4);
  await expect(footer.getByRole("link", { name: "GitHub" })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    GITHUB_URL,
  );
  const license = footer.getByRole("link", { name: "License", exact: true });
  await expect(license).toHaveAttribute("href", `${GITHUB_URL}/blob/main/LICENSE`);
  await expect(license).toHaveAttribute("target", "_blank");
  await expect(license).toHaveAttribute("rel", "noreferrer");
  for (const { name, hash } of POLICIES) {
    const link = footer.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", `#${hash}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`, "u"));
    await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Close ${name}`, exact: true }).press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(link).toBeFocused();
    await page.goto(`/#${hash}`);
    await page.reload();
    await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Close ${name}`, exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("footer wraps with keyboard focus and header GitHub at supported widths", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  const links = footer.getByRole("link");
  for (const width of [320, 768, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await footer.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByRole("banner").getByRole("link", { name: "GitHub" })).toBeVisible();
    await expect(footer.getByRole("navigation")).toHaveCSS("column-gap", "24px");
    const boxes = await links.evaluateAll((elements) =>
      elements.map((element) => {
        const { left, right, top, bottom, height } = element.getBoundingClientRect();
        return { left, right, top, bottom, height };
      }),
    );
    for (const [index, box] of boxes.entries()) {
      expect(box.height).toBeGreaterThanOrEqual(28);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      for (const other of boxes.slice(index + 1)) {
        expect(
          box.right <= other.left ||
            other.right <= box.left ||
            box.bottom <= other.top ||
            other.bottom <= box.top,
        ).toBe(true);
      }
    }
  }
  await links.first().focus();
  for (const link of await links.all()) {
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    await expect(link).toHaveCSS("outline-width", "2px");
    await page.keyboard.press("Tab");
  }
});

test("metadata, favicon, robots, and sitemap use the production origin", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("RepoDitor Web — Local R.E.P.O. Save Editor");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", PUBLIC_ORIGIN);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", PUBLIC_ORIGIN);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "RepoDitor Web",
  );
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]']) {
    await expect(page.locator(selector)).toHaveAttribute("content", /R\.E\.P\.O\. saves locally/u);
  }
  expect(await page.locator("head").innerHTML()).not.toMatch(/localhost|127\.0\.0\.1/u);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/icon.png");
  const icon = await request.get("/icon.png");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/png");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  expect(await robots.text()).toMatch(
    /^User-agent: \*\s+Allow: \/\s+Sitemap: https:\/\/repoditor\.vercel\.app\/sitemap\.xml\s*$/u,
  );
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const xml = await sitemap.text();
  const urls = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Invalid sitemap XML.");
    // This standard XML namespace is an identifier, not an HTTP request.
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    const namespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
    return Array.from(
      document.getElementsByTagNameNS(namespace, "loc"),
      (node) => node.textContent,
    );
  }, xml);
  expect(urls).toEqual([PUBLIC_ORIGIN]);
  expect(xml).not.toMatch(/localhost|127\.0\.0\.1|xml-stylesheet/u);
});
