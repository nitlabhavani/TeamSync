import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/Notifications";

export const Route = createFileRoute("/guide/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — TeamSync AI" },
      { name: "description", content: "Updates from your groups, tasks, and risk alerts." },
      { property: "og:title", content: "Notifications — TeamSync AI" },
      { property: "og:description", content: "Updates from your groups, tasks, and risk alerts." },
    ],
  }),
  component: Page,
});
