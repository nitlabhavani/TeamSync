import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/Settings";

export const Route = createFileRoute("/app/settings")({
  head: () => ({
    meta: [
      { title: "Settings — TeamSync AI" },
      {
        name: "description",
        content: "Control notifications, privacy and AI analysis preferences.",
      },
      { property: "og:title", content: "Settings — TeamSync AI" },
      {
        property: "og:description",
        content: "Control notifications, privacy and AI analysis preferences.",
      },
    ],
  }),
  component: Page,
});
