import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { wrap, HttpError } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { loadJoinedDataset } from "./context.js";
import { ruleParse, runIntent } from "../engine/intent.js";
import { llmParseIntent } from "../ai/provider.js";
import { deriveInsights } from "../engine/insights.js";
import * as A from "../engine/analytics.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);

// Headline insight + recommendations for the dashboard. Deterministic, no LLM.
aiRouter.get("/insights", wrap(async (req, res) => {
  const { rows, schema } = await loadJoinedDataset(req.auth!.organizationId, req.query.datasetId as string | undefined);
  const ov = A.overview(rows, schema);
  const { recommendations } = deriveInsights(rows, schema);
  const g = ov.growth;
  const headline = g === null
    ? `Revenue totals $${Math.round(ov.revenue.value).toLocaleString()} across the dataset.`
    : `Revenue ${g >= 0 ? "grew" : "declined"} ${Math.abs(g)}% period-over-period, at a ${ov.profitMargin}% profit margin.`;
  res.json({ headline, recommendations });
}));

const chatSchema = z.object({
  message: z.string().min(1).max(500),
  datasetId: z.string().optional(),
  conversationId: z.string().optional(),
});

// Natural-language question -> validated intent -> deterministic analytics answer.
// Write path (persists conversations) — VIEWER is read-only per the role matrix.
aiRouter.post("/chat", requireRole("ADMIN", "MANAGER"), wrap(async (req, res) => {
  const auth = req.auth!;
  const { message, datasetId, conversationId } = chatSchema.parse(req.body);
  const { dataset, rows, schema } = await loadJoinedDataset(auth.organizationId, datasetId);

  // Understand the question with GPT when configured; fall back to the deterministic
  // rule parser when it isn't (or on any failure). Either way, runIntent computes the
  // numbers deterministically — the model never sees the data rows.
  // A null result means the LLM was unavailable or failed; an "unknown" classification
  // means it ran but couldn't map the question. Both fall back to the rule parser, which
  // may still answer deterministically.
  const llmIntent = await llmParseIntent(message, schema);
  const intent = llmIntent && llmIntent.intent !== "unknown" ? llmIntent : ruleParse(message, schema);
  const result = runIntent(intent, rows, schema);

  // Persist conversation + both messages.
  const convo = conversationId
    ? await prisma.aIConversation.findFirst({ where: { id: conversationId, organizationId: auth.organizationId } })
    : null;
  const conversation = convo ?? await prisma.aIConversation.create({
    data: { organizationId: auth.organizationId, datasetId: dataset.id, title: message.slice(0, 60) },
  });

  await prisma.aIMessage.create({ data: { conversationId: conversation.id, role: "user", content: message } });
  const assistant = await prisma.aIMessage.create({
    data: { conversationId: conversation.id, role: "assistant", content: result.explanation, data: result as object },
  });

  res.json({ conversationId: conversation.id, message: { id: assistant.id, ...result } });
}));

aiRouter.get("/conversations", wrap(async (req, res) => {
  const conversations = await prisma.aIConversation.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });
  res.json({ conversations });
}));

aiRouter.get("/conversations/:id", wrap(async (req, res) => {
  const conversation = await prisma.aIConversation.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) throw new HttpError(404, "Conversation not found");
  res.json({ conversation });
}));
