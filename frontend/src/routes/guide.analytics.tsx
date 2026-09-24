import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/TeamAnalytics";

export const Route = createFileRoute("/guide/analytics")({
  head: () => ({
    meta: [
      { title: "Team analytics — TeamSync AI" },
      {
        name: "description",
        content: "Contribution, activity and progress charts across all your groups.",
      },
      { property: "og:title", content: "Team analytics — TeamSync AI" },
      {
        property: "og:description",
        content: "Contribution, activity and progress charts across all your groups.",
      },
    ],
  }),
  component: Page,
});
