import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/Calendar";

export const Route = createFileRoute("/app/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — TeamSync AI" },
      {
        name: "description",
        content: "Task deadlines, meetings, sprints and milestones for your team in one calendar.",
      },
      { property: "og:title", content: "Calendar — TeamSync AI" },
      {
        property: "og:description",
        content: "Task deadlines, meetings, sprints and milestones for your team in one calendar.",
      },
    ],
  }),
  component: Page,
});
