import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/Performance";

export const Route = createFileRoute("/app/performance")({
  head: () => ({
    meta: [
      { title: "Performance — TeamSync AI" },
      {
        name: "description",
        content: "Your contribution trend, AI prediction and personal collaboration score.",
      },
      { property: "og:title", content: "Performance — TeamSync AI" },
      {
        property: "og:description",
        content: "Your contribution trend, AI prediction and personal collaboration score.",
      },
    ],
  }),
  component: Page,
});
