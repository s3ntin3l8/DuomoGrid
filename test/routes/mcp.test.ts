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

    // 9. Cover list_listings, get_listing, generate_makler_inquiry, get_assumptions, update_assumptions, hypothetical simulate_analysis
    const listCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "list_listings",
          arguments: { offer: "buy", status: "visit", city: "Darmstadt", minScore: 10, maxPriceEur: 500000 },
        },
      },
    });
    expect(listCall.statusCode).toBe(200);
    expect(JSON.parse(listCall.json().result.content[0].text as string).count).toBe(1);

    const getCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "get_listing", arguments: { id: id1 } },
      },
    });
    expect(getCall.statusCode).toBe(200);
    expect(JSON.parse(getCall.json().result.content[0].text as string).id).toBe(id1);

    const getAssumptionsCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "get_assumptions", arguments: {} },
      },
    });
    expect(getAssumptionsCall.statusCode).toBe(200);

    const updateAssumptionsCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "update_assumptions", arguments: { interestPercent: 3.4, horizonYears: 15 } },
      },
    });
    expect(updateAssumptionsCall.statusCode).toBe(200);
    expect(JSON.parse(updateAssumptionsCall.json().result.content[0].text as string).assumptions.interestPercent).toBe(3.4);
    expect(JSON.parse(updateAssumptionsCall.json().result.content[0].text as string).assumptions.interestProvenance.source).toBe("user");

    const inquiryCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: { name: "generate_makler_inquiry", arguments: { id: id1, useLlm: false } },
      },
    });
    expect(inquiryCall.statusCode).toBe(200);
    expect(JSON.parse(inquiryCall.json().result.content[0].text as string).source).toBe("deterministic");

    const simHypoCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 15,
        method: "tools/call",
        params: {
          name: "simulate_analysis",
          arguments: { priceEur: 380000, livingAreaM2: 85, city: "Darmstadt", discountPercent: 5 },
        },
      },
    });
    expect(simHypoCall.statusCode).toBe(200);
    expect(JSON.parse(simHypoCall.json().result.content[0].text as string).listingTitle).toBe("Hypothetical listing");

    const simDiscountCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 16,
        method: "tools/call",
        params: {
          name: "simulate_analysis",
          arguments: { id: id1, discountPercent: 10, condoFeeEur: 250, energyClass: "B", yearRefurbished: 2022 },
        },
      },
    });
    expect(simDiscountCall.statusCode).toBe(200);
    expect(JSON.parse(simDiscountCall.json().result.content[0].text as string).simulated.priceEur).toBe(405000);

    const patchPriceCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 17,
        method: "tools/call",
        params: {
          name: "update_listing",
          arguments: { id: id1, priceEur: 440000, livingAreaM2: 92, yearBuilt: 1998, energyClass: "C" },
        },
      },
    });
    expect(patchPriceCall.statusCode).toBe(200);
    expect(JSON.parse(patchPriceCall.json().result.content[0].text as string).listing.priceEur).toBe(440000);

    const compareAutoCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 18,
        method: "tools/call",
        params: { name: "compare_listings", arguments: {} },
      },
    });
    expect(compareAutoCall.statusCode).toBe(200);
    expect(JSON.parse(compareAutoCall.json().result.content[0].text as string).count).toBe(2);

    const promptCompare = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 19,
        method: "prompts/get",
        params: { name: "portfolio-comparison", arguments: {} },
      },
    });
    expect(promptCompare.statusCode).toBe(200);

    const readPortfolio = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 20,
        method: "resources/read",
        params: { uri: "duomogrid://listings" },
      },
    });
    expect(readPortfolio.statusCode).toBe(200);

    const readAssumptions = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 21,
        method: "resources/read",
        params: { uri: "duomogrid://assumptions" },
      },
    });
    expect(readAssumptions.statusCode).toBe(200);

    const seedRates = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: { name: "update_assumptions", arguments: { energyRates: { gas: 0.2, district: 0.3 } } },
      },
    });
    const seeded = JSON.parse(seedRates.json().result.content[0].text as string).assumptions;
    expect(seeded.energyRates.gas).toBe(0.2);
    expect(seeded.energyRates.gasProvenance.source).toBe("user");

    const setRate = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 24,
        method: "tools/call",
        params: { name: "update_assumptions", arguments: { energyRates: { electric: 0.4 } } },
      },
    });
    const set = JSON.parse(setRate.json().result.content[0].text as string).assumptions;
    expect(set.energyRates.electric).toBe(0.4);
    expect(set.energyRates.electricProvenance.source).toBe("user");
    // A rate the caller did not name keeps the value and the origin it already had.
    expect(set.energyRates.gas).toBe(0.2);
    expect(set.energyRates.gasProvenance.source).toBe("user");
    expect(set.energyRates.district).toBe(0.3);
    expect(set.energyRates.districtProvenance.source).toBe("user");

    const batchMcp = await app.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: [
        { jsonrpc: "2.0", id: 22, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ],
    });
    expect(batchMcp.statusCode).toBe(200);
    expect(batchMcp.json()).toHaveLength(1);

    await app.close();
  });
});
