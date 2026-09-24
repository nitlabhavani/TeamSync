import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/LearningSearch";

export const Route = createFileRoute("/app/search")({
  head: () => ({
    meta: [
      { title: "Learning Search — TeamSync AI" },
      {
        name: "description",
        content: "Search programming concepts, educational doubts, and study topics with in-app AI search.",
      },
      { property: "og:title", content: "Learning Search — TeamSync AI" },
      {
        property: "og:description",
        content: "Search programming concepts, educational doubts, and study topics with in-app AI search.",
      },
    ],
  }),
  component: Page,
});
