import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

describe("routes/mcp", () => {
  afterEach(() => {
    delete process.env.INGEST_TOKEN;
  });

  it("enforces the ingest guard on /mcp (503 when unset, 401 when unauthorized)", async () => {
    delete process.env.INGEST_TOKEN;
    const appNoToken = await buildApp();
    const res503 = await appNoToken.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(res503.statusCode).toBe(503);
    await appNoToken.close();

    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const res401 = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(res401.statusCode).toBe(401);
    await app.close();
  });

  it("handles MCP JSON-RPC initialize, tools, resources, and prompts", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };

    // Seed two listings
    const l1 = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        source: "immobilienscout24",
        sourceUrl: "https://www.immobilienscout24.de/expose/101",
        externalId: "101",
        title: "ETW Darmstadt Mitte",
        offer: "buy",
        priceEur: 450000,
        livingAreaM2: 90,
        city: "Darmstadt",
        postalCode: "64283",
        state: "HE",
        propertyType: "apartment",
        condoFeeEur: 280,
      },
    });
    const l2 = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        source: "immobilienscout24",
        sourceUrl: "https://www.immobilienscout24.de/expose/102",
        externalId: "102",
        title: "ETW Darmstadt Bessungen",
        offer: "buy",
        priceEur: 520000,
        livingAreaM2: 100,
        city: "Darmstadt",
        postalCode: "64285",
        state: "HE",
        propertyType: "apartment",
        condoFeeEur: 320,
      },
    });
    const id1 = l1.json().id as string;
    const id2 = l2.json().id as string;

    // 1. initialize
    const initRes = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(initRes.statusCode).toBe(200);
    expect(initRes.json().result.serverInfo.name).toBe("duomogrid");

    // 2. notification returns 202
    const notifRes = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    expect(notifRes.statusCode).toBe(202);

    // 3. tools/list
    const toolsList = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(toolsList.statusCode).toBe(200);
    const toolNames = (toolsList.json().result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "list_listings",
        "get_listing",
        "simulate_analysis",
        "compare_listings",
        "generate_makler_inquiry",
        "get_assumptions",
        "update_assumptions",
        "update_listing",
        "extract_listing_description",
      ]),
    );

    // 4. tools/call simulate_analysis
    const simCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "simulate_analysis",
          arguments: { id: id1, priceEur: 400000, interestPercent: 3.0 },
        },
      },
    });
    expect(simCall.statusCode).toBe(200);
    const simData = JSON.parse(simCall.json().result.content[0].text as string);
    expect(simData.simulated.priceEur).toBe(400000);
    expect(simData.simulated.interestPercent).toBe(3);
    expect(simData.simulated.cashToCloseEur).toBeGreaterThan(0);

    // 5. tools/call compare_listings
    const cmpCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "compare_listings",
          arguments: { ids: [id1, id2] },
        },
      },
    });
    expect(cmpCall.statusCode).toBe(200);
    const cmpData = JSON.parse(cmpCall.json().result.content[0].text as string);
    expect(cmpData.compared).toHaveLength(2);

    // 6. tools/call update_listing
    const patchCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "update_listing",
          arguments: { id: id1, status: "visit", notes: "Check roof reserve" },
        },
      },
    });
    expect(patchCall.statusCode).toBe(200);
    const patchData = JSON.parse(patchCall.json().result.content[0].text as string);
    expect(patchData.status).toBe("visit");
    expect(patchData.notes).toBe("Check roof reserve");

    // 7. resources/list & resources/read
    const resList = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: { jsonrpc: "2.0", id: 6, method: "resources/list" },
    });
    expect(resList.statusCode).toBe(200);
    expect(resList.json().result.resources.length).toBeGreaterThanOrEqual(2);

    const resRead = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 7,
        method: "resources/read",
        params: { uri: `duomogrid://listings/${id1}` },
      },
    });
    expect(resRead.statusCode).toBe(200);
    const readListing = JSON.parse(resRead.json().result.contents[0].text as string);
    expect(readListing.id).toBe(id1);

    // 8. prompts/list & prompts/get
    const promptsList = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: { jsonrpc: "2.0", id: 8, method: "prompts/list" },
    });
    expect(promptsList.statusCode).toBe(200);
    expect(promptsList.json().result.prompts).toHaveLength(2);

    const promptGet = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 9,
        method: "prompts/get",
        params: { name: "due-diligence-review", arguments: { id: id1 } },
      },
    });
    expect(promptGet.statusCode).toBe(200);
    expect(promptGet.json().result.messages[0].content.text).toContain(id1);

    await app.close();
  });
});
