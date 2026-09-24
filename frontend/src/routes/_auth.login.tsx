import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/auth/Login";

export const Route = createFileRoute("/_auth/login")({
  head: () => ({
    meta: [
      { title: "Sign in — TeamSync AI" },
      {
        name: "description",
        content:
          "Sign in to your TeamSync AI workspace to reach your team chats, tasks and AI insights.",
      },
      { property: "og:title", content: "Sign in — TeamSync AI" },
      {
        property: "og:description",
        content:
          "Sign in to your TeamSync AI workspace to reach your team chats, tasks and AI insights.",
      },
    ],
  }),
  component: Page,
});
