import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/Alerts";

export const Route = createFileRoute("/guide/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts — TeamSync AI" },
      {
        name: "description",
        content: "AI-raised alerts for inactive members and stalled project groups.",
      },
      { property: "og:title", content: "Alerts — TeamSync AI" },
      {
        property: "og:description",
        content: "AI-raised alerts for inactive members and stalled project groups.",
      },
    ],
  }),
  component: Page,
});
