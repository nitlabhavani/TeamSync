import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/Notifications";

export const Route = createFileRoute("/app/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — TeamSync AI" },
      {
        name: "description",
        content: "Mentions, deadlines and AI nudges from your project groups.",
      },
      { property: "og:title", content: "Notifications — TeamSync AI" },
      {
        property: "og:description",
        content: "Mentions, deadlines and AI nudges from your project groups.",
      },
    ],
  }),
  component: Page,
});
