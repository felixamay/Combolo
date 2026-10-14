import { expect, test, type Page } from "@playwright/test";
import { ATTRIBUTIONS } from "../../config/admin";

async function passAgeGate(page: Page) {
  await page.context().addCookies([{ name: "combolo_age_ok", value: "1", url: "http://localhost:3100" }]);
}

test.describe("age gate & compliance", () => {
  test("blocks the site until the visitor confirms their age, then remembers it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("age-gate")).toBeVisible();
    await page.getByRole("button", { name: /Yes, I am 18\+/ }).click();
    await expect(page.getByTestId("age-gate")).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("age-gate")).toBeHidden();
  });

  test("declining shows a refusal", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByTestId("age-gate").getByRole("alert")).toContainText("must be 18");
  });

  test("footer carries the responsible-gambling notice and Sackmann attribution", async ({ page }) => {
    await passAgeGate(page);
    await page.goto("/");
    const footer = page.getByTestId("rg-footer");
    await expect(footer).toContainText("statistical estimates, not guarantees");
    await expect(footer).toContainText("does not accept bets");
    await expect(footer).toContainText("1-800-GAMBLER");
    await expect(page.locator("footer")).toContainText("Jeff Sackmann");
  });
});

test.describe("home and sport pages", () => {
  test.beforeEach(async ({ page }) => passAgeGate(page));

  test("shows freshness, sport cards and tracked mixed combos", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("freshness")).toContainText("Data refreshed");
    await expect(page.getByTestId("sport-card")).toHaveCount(9);
    await expect(page.getByTestId("combo-card").first()).toBeVisible();
    await expect(page.getByTestId("combined-prob").first()).toContainText("%");
  });

  test("sport page lists fixtures by day with picks, and says plainly when a combo is impossible", async ({ page }) => {
    await page.goto("/sport/tennis");
    await expect(page.getByRole("heading", { name: /Today/ })).toBeVisible();
    await expect(page.getByTestId("match-row")).toHaveCount(9);
    await expect(page.getByTestId("size-limit")).toContainText("Only 9 eligible tennis matches today");
    await expect(page.getByTestId("combo-card")).toHaveCount(1);
    await page.goto("/sport/hockey");
    await expect(page.getByTestId("no-combos")).toContainText("Only 4 eligible ice hockey games");
    await expect(page.getByTestId("size-limit")).toContainText("fewer than the 7 legs");
  });
});

test.describe("combos", () => {
  test.beforeEach(async ({ page }) => passAgeGate(page));

  test("custom builder: a valid size gives exactly that many legs, one per match, with honest probability", async ({ page }) => {
    await page.goto("/combos?size=12&strategy=TOP");
    const rows = page.getByTestId("leg-row");
    await expect(rows).toHaveCount(12);
    const hrefs = await page.locator('[data-testid="leg-row"] a[href^="/matches/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(new Set(hrefs).size).toBe(12);
    await expect(page.getByTestId("combined-prob")).toContainText("%");
    await expect(page.getByTestId("rg-notice")).toBeVisible();
    await expect(page.getByTestId("live-combo")).toContainText("1 in");
  });

  test("filters by sport and shows sport labels on every leg", async ({ page }) => {
    await page.goto("/combos?size=8&sport=basketball&sport=football");
    await expect(page.getByTestId("leg-row")).toHaveCount(8);
    const labels = await page.locator('[data-testid="leg-row"] td:nth-child(2) span.chip').allTextContents();
    for (const l of labels) expect(l).toMatch(/Football|Basketball/);
  });

  test("refuses to pad: not enough eligible matches", async ({ page }) => {
    await page.goto("/combos?size=12&sport=tennis");
    await expect(page.getByTestId("insufficient")).toContainText("Only 9 eligible tennis matches today");
    await expect(page.getByTestId("leg-row")).toHaveCount(0);
  });

  test("rejects out-of-range sizes", async ({ page }) => {
    await page.goto("/combos?size=6");
    await expect(page.getByTestId("insufficient")).toContainText("between 7 and 32");
    await page.goto("/combos?size=40");
    await expect(page.getByTestId("insufficient")).toContainText("between 7 and 32");
  });

  test("minimum confidence filter is honoured", async ({ page }) => {
    await page.goto("/combos?size=7&minConf=65");
    const percents = await page.locator('[data-testid="leg-row"] td:nth-child(6)').allTextContents();
    expect(percents.length).toBe(7);
    for (const p of percents) expect(Number(p.replace("%", "").trim())).toBeGreaterThanOrEqual(65);
  });

  test("stored combo detail shows legs, status and per-combo responsible-gambling notice", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("combo-card").first().click();
    await expect(page).toHaveURL(/\/combos\/.+/);
    await expect(page.getByTestId("legs-table")).toBeVisible();
    const n = await page.getByTestId("leg-row").count();
    expect(n).toBeGreaterThanOrEqual(7);
    expect(n).toBeLessThanOrEqual(32);
    await expect(page.getByTestId("rg-notice")).toContainText("Statistical estimate, not a guarantee");
    await expect(page.getByTestId("leg-tally")).toContainText("0 / 0 /");
  });
});

test.describe("match, rankings, history, model", () => {
  test.beforeEach(async ({ page }) => passAgeGate(page));

  test("match page shows the pick, why, standings, form and the full H2H table", async ({ page }) => {
    await page.goto("/sport/football");
    await page.getByTestId("match-row").first().getByRole("link").click();
    await expect(page.getByTestId("pick-card")).toContainText("Model pick");
    await expect(page.getByTestId("components-table")).toContainText("Elo rating");
    await expect(page.getByTestId("side-card")).toHaveCount(2);
    await expect(page.getByTestId("h2h")).toBeVisible();
  });

  test("a football match with past meetings lists every stored meeting", async ({ page }) => {
    await page.goto("/sport/football");
    const hrefs = await page.locator('[data-testid="match-row"] a[href^="/matches/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    let found = false;
    for (const href of hrefs) {
      await page.goto(href);
      const rows = await page.getByTestId("h2h-row").count();
      if (rows > 0) {
        const summary = await page.getByTestId("h2h-summary").textContent();
        expect(summary).toContain(`${rows} stored meeting`);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("standings and rankings pages render stored tables", async ({ page }) => {
    await page.goto("/rankings/football");
    await expect(page.getByTestId("standings-table").first()).toContainText("Test Premier Division");
    await page.goto("/rankings/tennis");
    await expect(page.getByTestId("standings-table").first()).toContainText("ATP singles ranking");
  });

  test("history shows hit rate per combo size from settled results", async ({ page }) => {
    await page.goto("/history");
    const table = page.getByTestId("hit-rate-table");
    await expect(table).toContainText("50.0%");
    await expect(page.getByTestId("history-row").first()).toBeVisible();
  });

  test("about-the-model page is honest when there is no back-test yet", async ({ page }) => {
    await page.goto("/about-model");
    await expect(page.getByTestId("backtest")).toContainText("No back-test has been run yet");
    await expect(page.getByRole("cell", { name: "Elo rating" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "0.85" })).toBeVisible();
  });

  test("data sources page attributes every provider", async ({ page }) => {
    await page.goto("/data-sources");
    await expect(page.getByTestId("attribution")).toHaveCount(ATTRIBUTIONS.length);
    await expect(page.getByText("CC BY-NC-SA 4.0").first()).toBeVisible();
  });

  test("responsible gambling page lists help lines", async ({ page }) => {
    await page.goto("/responsible-gambling");
    await expect(page.getByText("1-800-GAMBLER").first()).toBeVisible();
  });
});

test.describe("preferences @desktop-only", () => {
  test("time zone selection changes the window and persists", async ({ page }) => {
    await passAgeGate(page);
    await page.goto("/");
    await page.getByLabel("Time zone").selectOption("Pacific/Auckland");
    await expect(page.locator("main p").first()).toContainText("Pacific/Auckland".replace("/", "/"));
    await page.reload();
    await expect(page.getByLabel("Time zone")).toHaveValue("Pacific/Auckland");
  });

  test("dark mode toggles and persists", async ({ page }) => {
    await passAgeGate(page);
    await page.goto("/");
    await page.getByRole("button", { name: /dark mode/i }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("cron endpoint refuses requests without the secret", async ({ request }) => {
    expect((await request.get("/api/cron/refresh")).status()).toBe(401);
    expect((await request.get("/api/cron/nope", { headers: { authorization: "Bearer e2e-secret" } })).status()).toBe(404);
  });
});
