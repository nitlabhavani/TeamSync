import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/GroupDetails";

export const Route = createFileRoute("/app/groups/$groupId")({
  head: () => ({
    meta: [
      { title: "Group workspace — TeamSync AI" },
      {
        name: "description",
        content: "Group chat, shared files, tasks and AI collaboration insights.",
      },
      { property: "og:title", content: "Group workspace — TeamSync AI" },
      {
        property: "og:description",
        content: "Group chat, shared files, tasks and AI collaboration insights.",
      },
    ],
  }),
  component: Page,
});
