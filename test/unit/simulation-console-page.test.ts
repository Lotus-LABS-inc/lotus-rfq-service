import { describe, expect, it } from "vitest";

import { renderSimulationConsolePage } from "../../src/api/admin/simulation-console.page.js";

describe("renderSimulationConsolePage", () => {
  it("includes routeability summary controls and pane", () => {
    const html = renderSimulationConsolePage();

    expect(html).toContain('id="category-filter"');
    expect(html).toContain('All categories');
    expect(html).toContain('id="catalog-scope"');
    expect(html).toContain('Historical only');
    expect(html).toContain('Live only');
    expect(html).toContain('id="routeability-summary"');
    expect(html).toContain('/admin/simulation/routeability-summary');
    expect(html).toContain('Opinion routeability');
    expect(html).toContain('Exact live-only overlaps');
    expect(html).toContain('Near-miss candidates');
    expect(html).toContain('Predict routeability');
  });
});
