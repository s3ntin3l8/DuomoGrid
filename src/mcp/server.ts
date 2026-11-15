import { executeAgentTool, getAgentTools, type AgentDeps } from "./tools.js";

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const SUPPORTED_VERSIONS = new Set(["2024-11-05", "2025-03-26"]);

export async function handleMcpRequest(
  deps: AgentDeps,
  req: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  if (!req || typeof req !== "object" || typeof req.method !== "string") {
    return {
      jsonrpc: "2.0",
      id: req?.id ?? null,
      error: { code: -32600, message: "Invalid JSON-RPC request." },
    };
  }

  const isNotification = req.id === undefined;
  const id = req.id ?? null;
  const method = req.method;
  const params =
    req.params && typeof req.params === "object" && !Array.isArray(req.params)
      ? req.params
      : {};

  if (method.startsWith("notifications/")) {
    return null;
  }

  try {
    if (method === "initialize") {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_VERSIONS.has(requested) ? requested : "2024-11-05";
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: "duomogrid",
            version: "0.1.5",
          },
        },
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      const tools = getAgentTools({ readOnly: false }).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      return { jsonrpc: "2.0", id, result: { tools } };
    }

    if (method === "tools/call") {
      const toolName = typeof params.name === "string" ? params.name : "";
      const toolArgs =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (!toolName) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing tool name." },
        };
      }
      const { result } = await executeAgentTool(deps, toolName, toolArgs);
      const isError = Boolean(
        result &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          "error" in (result as Record<string, unknown>),
      );
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError,
        },
      };
    }

    if (method === "resources/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resources: [
            {
              uri: "duomogrid://assumptions",
              name: "Financing & Valuation Assumptions",
              description: "Global financing, tax, upkeep, and horizon assumptions.",
              mimeType: "application/json",
            },
            {
              uri: "duomogrid://listings",
              name: "Saved Listings",
              description: "Summary of all saved buy and rent listings with scores and monthly costs.",
              mimeType: "application/json",
            },
          ],
        },
      };
    }

    if (method === "resources/templates/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          resourceTemplates: [
            {
              uriTemplate: "duomogrid://listings/{id}",
              name: "Listing Detail",
              description: "Full detail, analysis, findings, and price history for one listing.",
              mimeType: "application/json",
            },
          ],
        },
      };
    }

    if (method === "resources/read") {
      const uri = typeof params.uri === "string" ? params.uri : "";
      if (uri === "duomogrid://assumptions") {
        const { result } = await executeAgentTool(deps, "get_assumptions", {});
        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }
      if (uri === "duomogrid://listings") {
        const { result } = await executeAgentTool(deps, "list_listings", {});
        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }
      const match = /^duomogrid:\/\/listings\/([^/]+)$/.exec(uri);
      if (match) {
        const { result } = await executeAgentTool(deps, "get_listing", { id: match[1] });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown resource URI "${uri}".` },
      };
    }

    if (method === "prompts/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          prompts: [
            {
              name: "due-diligence-review",
              description:
                "Deep-dive due-diligence analysis of a saved listing, including negotiation angles and German questions for the Makler.",
              arguments: [
                {
                  name: "id",
                  description: "The listing UUID.",
                  required: true,
                },
              ],
            },
            {
              name: "portfolio-comparison",
              description:
                "Compare top saved buy candidates on monthly carrying cost, cash to close, refinancing risk, and rent-vs-buy horizon.",
              arguments: [
                {
                  name: "city",
                  description: "Optional city filter.",
                  required: false,
                },
              ],
            },
          ],
        },
      };
    }

    if (method === "prompts/get") {
      const promptName = typeof params.name === "string" ? params.name : "";
      const promptArgs =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (promptName === "due-diligence-review") {
        const listingId = String(promptArgs.id ?? "").trim();
        return {
          jsonrpc: "2.0",
          id,
          result: {
            description: `Due-diligence review for listing ${listingId}`,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Use get_listing and generate_makler_inquiry for listing ID "${listingId}". Summarize the financial picture (cash to close, monthly total, max-offer thresholds, and Zinsbindung refinancing risk), highlight red flags from the description, and provide the German Makler inquiry message.`,
                },
              },
            ],
          },
        };
      }
      if (promptName === "portfolio-comparison") {
        const city = typeof promptArgs.city === "string" ? promptArgs.city.trim() : "";
        return {
          jsonrpc: "2.0",
          id,
          result: {
            description: "Portfolio comparison",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Use list_listings${city ? ` with city="${city}"` : ""} and compare_listings to rank my saved purchases, compare their monthly totals and 10-year rent-vs-buy net wealth, and recommend which ones deserve a viewing.`,
                },
              },
            ],
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown prompt "${promptName}".` },
      };
    }

    if (isNotification) return null;
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method "${method}" not found.` },
    };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : "Internal MCP error.",
      },
    };
  }
}
