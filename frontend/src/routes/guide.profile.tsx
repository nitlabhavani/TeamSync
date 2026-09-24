import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/GuideProfile";

export const Route = createFileRoute("/guide/profile")({
  head: () => ({
    meta: [
      { title: "Guide profile — TeamSync AI" },
      {
        name: "description",
        content: "Your designation, department, qualification and contact details.",
      },
      { property: "og:title", content: "Guide profile — TeamSync AI" },
      {
        property: "og:description",
        content: "Your designation, department, qualification and contact details.",
      },
    ],
  }),
  component: Page,
});
