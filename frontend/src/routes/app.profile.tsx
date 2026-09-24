import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/Profile";

export const Route = createFileRoute("/app/profile")({
  head: () => ({
    meta: [
      { title: "Profile — TeamSync AI" },
      { name: "description", content: "Your TeamSync AI profile, department and project history." },
      { property: "og:title", content: "Profile — TeamSync AI" },
      {
        property: "og:description",
        content: "Your TeamSync AI profile, department and project history.",
      },
    ],
  }),
  component: Page,
});
