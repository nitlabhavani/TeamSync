import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/AISummary";

export const Route = createFileRoute("/guide/ai-summary")({
  head: () => ({
    meta: [
      { title: "AI summary — TeamSync AI" },
      {
        name: "description",
        content: "AI-written summaries of group chats, blockers and next steps.",
      },
      { property: "og:title", content: "AI summary — TeamSync AI" },
      {
        property: "og:description",
        content: "AI-written summaries of group chats, blockers and next steps.",
      },
    ],
  }),
  component: Page,
});
