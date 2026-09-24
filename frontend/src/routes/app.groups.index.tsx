import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/Groups";

export const Route = createFileRoute("/app/groups/")({
  head: () => ({
    meta: [
      { title: "Groups — TeamSync AI" },
      {
        name: "description",
        content: "All the project groups you belong to, plus people you can chat with.",
      },
      { property: "og:title", content: "Groups — TeamSync AI" },
      {
        property: "og:description",
        content: "All the project groups you belong to, plus people you can chat with.",
      },
    ],
  }),
  component: Page,
});
