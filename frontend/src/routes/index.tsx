import { createFileRoute } from "@tanstack/react-router";
import Home from "@/pages/common/Home";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TeamSync AI — Collaborate, share and let AI track momentum" },
      {
        name: "description",
        content:
          "TeamSync AI brings group chat, secure file sharing, Kanban tasks, meetings, peer reviews and AI collaboration scoring into one workspace for student project teams.",
      },
      {
        property: "og:title",
        content: "TeamSync AI — Collaborate, share and let AI track momentum",
      },
      {
        property: "og:description",
        content:
          "Group chat, files, tasks, meetings and AI collaboration insights for student project teams.",
      },
    ],
  }),
  component: Home,
});
