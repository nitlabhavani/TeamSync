import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/Calendar";

export const Route = createFileRoute("/guide/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — TeamSync AI" },
      {
        name: "description",
        content:
          "Task deadlines, meetings, sprints and milestones across your groups in one calendar.",
      },
      { property: "og:title", content: "Calendar — TeamSync AI" },
      {
        property: "og:description",
        content:
          "Task deadlines, meetings, sprints and milestones across your groups in one calendar.",
      },
    ],
  }),
  component: Page,
});
