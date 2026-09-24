import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/LearningSearch";

export const Route = createFileRoute("/guide/search")({
  head: () => ({
    meta: [
      { title: "Learning Search — TeamSync AI Guide" },
      {
        name: "description",
        content: "Search programming concepts, educational doubts, and study topics with in-app AI search.",
      },
      { property: "og:title", content: "Learning Search — TeamSync AI Guide" },
      {
        property: "og:description",
        content: "Search programming concepts, educational doubts, and study topics with in-app AI search.",
      },
    ],
  }),
  component: Page,
});
