import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/PrivateChat";

export const Route = createFileRoute("/app/chat/$userId")({
  head: () => ({
    meta: [
      { title: "Private chat — TeamSync AI" },
      { name: "description", content: "A private one-to-one conversation that AI never analyzes." },
      { property: "og:title", content: "Private chat — TeamSync AI" },
      {
        property: "og:description",
        content: "A private one-to-one conversation that AI never analyzes.",
      },
    ],
  }),
  component: Page,
});
