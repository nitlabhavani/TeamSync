import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/GuideDashboard";

export const Route = createFileRoute("/guide/dashboard")({
  head: () => ({
    meta: [
      { title: "Guide overview — TeamSync AI" },
      {
        name: "description",
        content: "Every group's health, progress and risk in one guide dashboard.",
      },
      { property: "og:title", content: "Guide overview — TeamSync AI" },
      {
        property: "og:description",
        content: "Every group's health, progress and risk in one guide dashboard.",
      },
    ],
  }),
  component: Page,
});
