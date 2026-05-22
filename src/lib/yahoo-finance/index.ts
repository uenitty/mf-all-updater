import * as v from "valibot";

const ChartResourceSchema = v.object({
  meta: v.optional(
    v.object({
      regularMarketPrice: v.optional(v.number()),
      currency: v.optional(v.string()),
      symbol: v.optional(v.string()),
    }),
  ),
});

const ChartEndpointResponseSchema = v.object({
  chart: v.object({
    result: v.optional(v.nullable(v.array(ChartResourceSchema))),
    error: v.optional(
      v.nullable(
        v.object({
          description: v.string(),
        }),
      ),
    ),
  }),
});

type ChartResource = v.InferOutput<typeof ChartResourceSchema>;

async function getChart(symbol: string): Promise<ChartResource> {
  const response = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}`,
  );
  if (!response.ok) {
    throw new Error(
      `Yahoo Finance request failed: ${response.status} ${response.statusText}`,
    );
  }
  const body: unknown = await response.json();
  const parsed = v.parse(ChartEndpointResponseSchema, body);
  if (parsed.chart.error) {
    throw new Error(
      `Yahoo Finance chart error: ${parsed.chart.error.description}`,
    );
  }
  const result = parsed.chart.result?.[0];
  if (!result) {
    throw new Error(`Yahoo Finance returned no chart result for ${symbol}`);
  }
  return result;
}

export const chart = {
  get: getChart,
};
