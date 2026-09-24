import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/Tasks";

export const Route = createFileRoute("/app/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks & sprint board — TeamSync AI" },
      {
        name: "description",
        content:
          "Kanban board with drag-and-drop tasks and AI workload balancing for your project team.",
      },
      { property: "og:title", content: "Tasks & sprint board — TeamSync AI" },
      {
        property: "og:description",
        content:
          "Kanban board with drag-and-drop tasks and AI workload balancing for your project team.",
      },
    ],
  }),
  component: Page,
});
