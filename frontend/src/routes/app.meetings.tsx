import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/Meetings";

export const Route = createFileRoute("/app/meetings")({
  head: () => ({
    meta: [
      { title: "Meetings & smart notes — TeamSync AI" },
      {
        name: "description",
        content:
          "Schedule team syncs and turn raw meeting notes into AI decisions, action items and risks.",
      },
      { property: "og:title", content: "Meetings & smart notes — TeamSync AI" },
      {
        property: "og:description",
        content:
          "Schedule team syncs and turn raw meeting notes into AI decisions, action items and risks.",
      },
    ],
  }),
  component: Page,
});
