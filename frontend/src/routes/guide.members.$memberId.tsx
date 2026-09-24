import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/MemberDetails";

export const Route = createFileRoute("/guide/members/$memberId")({
  head: () => ({
    meta: [
      { title: "Member details — TeamSync AI" },
      {
        name: "description",
        content: "A single student's contribution, activity and AI performance signals.",
      },
      { property: "og:title", content: "Member details — TeamSync AI" },
      {
        property: "og:description",
        content: "A single student's contribution, activity and AI performance signals.",
      },
    ],
  }),
  component: Page,
});
