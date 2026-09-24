import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/MessagesPage";

export const Route = createFileRoute("/guide/chat/$userId")({
  head: () => ({
    meta: [
      { title: "Private chat — TeamSync AI Guide" },
      { name: "description", content: "A private one-to-one conversation that AI never analyzes." },
      { property: "og:title", content: "Private chat — TeamSync AI Guide" },
      {
        property: "og:description",
        content: "A private one-to-one conversation that AI never analyzes.",
      },
    ],
  }),
  component: () => <Page routeBase="/guide" />,
});
