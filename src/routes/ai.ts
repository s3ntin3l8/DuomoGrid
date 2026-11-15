import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { installIngestGuard } from "../auth/guard.js";
import { listings, settings } from "../db/schema.js";
import {
  applyAiSettingsUpdate,
  isAiConfigured,
  runAgentChat,
  serializeAiSettings,
  testAiProvider,
  toPublicAiSettings,
  type ChatMessage,
} from "../domain/ai.js";
import type { analyze } from "../domain/analyze.js";
import { extractDescriptionWithLlm } from "../domain/describe.js";
import {
  buildDueDiligenceInquiry,
  refineInquiryWithLlm,
} from "../domain/inquiry.js";
import type { ListingInput } from "../domain/types.js";
import { executeAgentTool, getAgentTools } from "../mcp/tools.js";
import {
  asInput,
  createListingPresenter,
  loadCurrentAiSettings,
} from "./listings.js";

function sanitizeChatMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 24) return null;
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const msg = item as Record<string, unknown>;
    if (msg.role !== "user" && msg.role !== "assistant") return null;
    if (typeof msg.content !== "string") return null;
    const content = msg.content.trim().slice(0, 6000);
    if (!content) continue;
    out.push({ role: msg.role, content });
  }
  return out.length > 0 ? out : null;
}

export async function aiRoute(app: FastifyInstance) {
  installIngestGuard(app, "/ai");
  const presenter = createListingPresenter(app.db);

  function currentAiSettings() {
    return loadCurrentAiSettings(app.db, app.config, app.encryption);
  }

  app.get("/ai/settings", async () => {
    return toPublicAiSettings(currentAiSettings(), app.encryption);
  });

  app.put("/ai/settings", async (request, reply) => {
    const current = currentAiSettings();
    const updated = applyAiSettingsUpdate(current, request.body);
    if (!updated.ok) return reply.code(400).send({ error: updated.error });
    let value: string;
    try {
      value = serializeAiSettings(updated.settings, app.encryption);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "Could not save AI settings.",
      });
    }
    const existing = app.db.select().from(settings).where(eq(settings.key, "ai")).all()[0];
    if (existing) {
      app.db.update(settings).set({ value }).where(eq(settings.key, "ai")).run();
    } else {
      app.db.insert(settings).values({ key: "ai", value }).run();
    }
    return toPublicAiSettings(currentAiSettings(), app.encryption);
  });

  app.post("/ai/test", async (request, reply) => {
    const current = currentAiSettings();
    let candidate = current;
    if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
      const merged = applyAiSettingsUpdate(current, request.body);
      if (!merged.ok) return reply.code(400).send({ ok: false, error: merged.error });
      candidate = merged.settings;
    }
    return testAiProvider(candidate);
  });

  app.post<{ Params: { id: string } }>("/ai/extract/:id", async (request, reply) => {
    const row = app.db.select().from(listings).where(eq(listings.id, request.params.id)).all()[0];
    if (!row) return reply.code(404).send({ error: "Listing not found." });
    const aiSettings = currentAiSettings();
    if (!isAiConfigured(aiSettings)) {
      return reply
        .code(400)
        .send({ error: "Configure an AI provider and model in the AI settings first." });
    }
    const ctx = presenter.context();
    const input = asInput(row, ctx.priceMap.get(row.id) ?? null);
    try {
      const extracted = await extractDescriptionWithLlm(
        aiSettings,
        input.description,
        input.details,
        row.descriptionJson,
      );
      const now = new Date().toISOString();
      app.db
        .update(listings)
        .set({
          llmExtractionJson: JSON.stringify(extracted),
          updatedAt: now,
        })
        .where(eq(listings.id, row.id))
        .run();
      const refreshed = app.db.select().from(listings).where(eq(listings.id, row.id)).all()[0];
      return presenter.present(refreshed, ctx.priceMap, ctx.past, ctx.model, true);
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : "AI extraction failed.",
      });
    }
  });

  app.post<{ Params: { id: string }; Body: { useLlm?: unknown } }>(
    "/ai/inquiry/:id",
    async (request, reply) => {
      const row = app.db.select().from(listings).where(eq(listings.id, request.params.id)).all()[0];
      if (!row) return reply.code(404).send({ error: "Listing not found." });
      const ctx = presenter.context();
      const presented = presenter.present(row, ctx.priceMap, ctx.past, ctx.model, true);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const wantsLlm = body.useLlm === true;
      const aiSettings = currentAiSettings();
      if (wantsLlm && !isAiConfigured(aiSettings)) {
        return reply
          .code(400)
          .send({ error: "Configure an AI provider in the AI settings first." });
      }
      try {
        if (wantsLlm) {
          return await refineInquiryWithLlm(aiSettings, {
            listing: presented.listing as ListingInput,
            analysis: presented.analysis as ReturnType<typeof analyze>,
            findings: presented.descriptionFindings,
          });
        }
        return buildDueDiligenceInquiry({
          listing: presented.listing as ListingInput,
          analysis: presented.analysis as ReturnType<typeof analyze>,
          findings: presented.descriptionFindings,
        });
      } catch (err) {
        return reply.code(502).send({
          error: err instanceof Error ? err.message : "Could not generate inquiry.",
        });
      }
    },
  );

  app.post<{ Body: { messages?: unknown; listingId?: unknown } }>(
    "/ai/chat",
    async (request, reply) => {
      const aiSettings = currentAiSettings();
      if (!isAiConfigured(aiSettings)) {
        return reply
          .code(400)
          .send({ error: "Configure an AI provider and model in the AI settings first." });
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const messages = sanitizeChatMessages(body.messages);
      if (!messages) {
        return reply
          .code(400)
          .send({ error: "Provide between 1 and 24 chat messages." });
      }

      const listingId =
        typeof body.listingId === "string" && body.listingId.trim()
          ? body.listingId.trim()
          : null;
      const ctx = presenter.context();
      let activeContext = "";
      if (listingId) {
        const row = app.db.select().from(listings).where(eq(listings.id, listingId)).all()[0];
        if (row) {
          const detail = presenter.present(row, ctx.priceMap, ctx.past, ctx.model, true);
          activeContext = `\nActive listing context (ID: "${detail.id}"):\n${JSON.stringify({
            id: detail.id,
            title: detail.listing.title,
            offer: detail.listing.offer,
            city: detail.listing.city,
            district: detail.listing.district,
            propertyType: detail.listing.propertyType,
            priceEur: detail.listing.priceEur,
            livingAreaM2: detail.listing.livingAreaM2,
            rooms: detail.listing.rooms,
            yearBuilt: detail.listing.yearBuilt,
            energyClass: detail.listing.energyClass,
            energySource: detail.listing.energySource,
            condoFeeEur: detail.listing.condoFeeEur,
            score: detail.analysis.score,
            verdict: detail.analysis.verdict,
            cashToCloseEur: detail.analysis.cashToCloseEur,
            loanEur: detail.analysis.loanEur,
            monthlyDebt: detail.analysis.monthlyDebt,
            monthlyTotal: detail.analysis.monthlyTotal,
            monthlyPartial: detail.analysis.monthlyPartial,
            remainingDebtEur: detail.analysis.remainingDebtEur,
            maxOffer: detail.maxOffer,
            flags: detail.analysis.flags,
            descriptionFindings: detail.descriptionFindings,
          })}`;
        }
      }

      const system = `You are DuomoGrid's real-estate analyst assistant.
Rules:
1. Answer in concise English (unless drafting a German question/message for a real-estate agent / Makler).
2. NEVER guess or calculate German transfer taxes, notary fees, loan annuities, or scores in your head. Use the "simulate_analysis", "get_listing", "list_listings", "compare_listings", or "generate_makler_inquiry" tools so every EUR figure comes from DuomoGrid's deterministic calculator.
3. Unknown amounts in DuomoGrid are null, never 0. Rental listings are never scored against purchases.
Current financing assumptions: ${JSON.stringify(ctx.model)}${activeContext}`;

      const deps = {
        db: app.db,
        encryption: app.encryption,
        envConfig: app.config,
      };
      try {
        const result = await runAgentChat(aiSettings, {
          system,
          messages,
          tools: getAgentTools({ readOnly: true }),
          executeTool: (name, args) => executeAgentTool(deps, name, args, { readOnly: true }),
        });
        return result;
      } catch (err) {
        return reply.code(502).send({
          error: err instanceof Error ? err.message : "AI chat request failed.",
        });
      }
    },
  );
}
