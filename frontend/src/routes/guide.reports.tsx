import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/Reports";

export const Route = createFileRoute("/guide/reports")({
  head: () => ({
    meta: [
      { title: "Reports — TeamSync AI" },
      {
        name: "description",
        content: "Exportable progress and contribution reports for every group.",
      },
      { property: "og:title", content: "Reports — TeamSync AI" },
      {
        property: "og:description",
        content: "Exportable progress and contribution reports for every group.",
      },
    ],
  }),
  component: Page,
});
