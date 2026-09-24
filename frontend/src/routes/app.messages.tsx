import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/MessagesPage";

export const Route = createFileRoute("/app/messages")({
  head: () => ({
    meta: [
      { title: "Messages — TeamSync AI" },
      {
        name: "description",
        content: "Direct messages, voice recordings, and private calling with teammates and guides.",
      },
      { property: "og:title", content: "Messages — TeamSync AI" },
    ],
  }),
  component: () => <Page routeBase="/app" />,
});
