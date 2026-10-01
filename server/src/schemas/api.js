import { z } from "zod";

export const refreshQuery = z.object({
  refresh: z.enum(["0", "1"]).optional(),
});

export const alertIdParam = z.object({
  id: z.string().regex(/^[a-z0-9._:-]+$/i).max(120),
});

export const insightSchema = z.object({
  summary: z.string().min(1),
  insights: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        confidence: z.enum(["high", "medium", "low"]),
        tags: z.array(z.string()).default([]),
      })
    )
    .min(1),
  recommendations: z.array(z.string().min(1)).min(1),
});

export const PROMPT_VERSION = "v2-narrative-only";
