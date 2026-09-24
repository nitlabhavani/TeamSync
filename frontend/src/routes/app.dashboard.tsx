import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/StudentDashboard";

export const Route = createFileRoute("/app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — TeamSync AI" },
      {
        name: "description",
        content: "Your team momentum, alerts and recent activity at a glance.",
      },
      { property: "og:title", content: "Dashboard — TeamSync AI" },
      {
        property: "og:description",
        content: "Your team momentum, alerts and recent activity at a glance.",
      },
    ],
  }),
  component: Page,
});
