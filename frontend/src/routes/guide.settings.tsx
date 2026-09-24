import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/GuideSettings";

export const Route = createFileRoute("/guide/settings")({
  head: () => ({
    meta: [
      { title: "Guide settings — TeamSync AI" },
      {
        name: "description",
        content: "Notification preferences, theme and password for your guide account.",
      },
      { property: "og:title", content: "Guide settings — TeamSync AI" },
      {
        property: "og:description",
        content: "Notification preferences, theme and password for your guide account.",
      },
    ],
  }),
  component: Page,
});
