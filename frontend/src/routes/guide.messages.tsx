import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/MessagesPage";

export const Route = createFileRoute("/guide/messages")({
  head: () => ({
    meta: [
      { title: "Messages — TeamSync AI Guide" },
      {
        name: "description",
        content: "Direct messages, voice recordings, and private calling with supervised students and guides.",
      },
      { property: "og:title", content: "Messages — TeamSync AI Guide" },
    ],
  }),
  component: () => <Page routeBase="/guide" />,
});
