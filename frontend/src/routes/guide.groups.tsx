import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/GroupManagement";

export const Route = createFileRoute("/guide/groups")({
  head: () => ({
    meta: [
      { title: "Group management — TeamSync AI" },
      {
        name: "description",
        content: "Create groups, assign members and review team composition.",
      },
      { property: "og:title", content: "Group management — TeamSync AI" },
      {
        property: "og:description",
        content: "Create groups, assign members and review team composition.",
      },
    ],
  }),
  component: Page,
});
