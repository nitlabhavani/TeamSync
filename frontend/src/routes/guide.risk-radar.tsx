import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/RiskRadar";

export const Route = createFileRoute("/guide/risk-radar")({
  head: () => ({
    meta: [
      { title: "Risk & deadline radar — TeamSync AI" },
      {
        name: "description",
        content:
          "AI-scored project health, overdue work and deadline timeline across every supervised group.",
      },
      { property: "og:title", content: "Risk & deadline radar — TeamSync AI" },
      {
        property: "og:description",
        content:
          "AI-scored project health, overdue work and deadline timeline across every supervised group.",
      },
    ],
  }),
  component: Page,
});
