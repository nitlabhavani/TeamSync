import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/student/PeerReview";

export const Route = createFileRoute("/app/peer-review")({
  head: () => ({
    meta: [
      { title: "Peer review & badges — TeamSync AI" },
      {
        name: "description",
        content:
          "Give teammates structured feedback and earn recognition badges from your contributions.",
      },
      { property: "og:title", content: "Peer review & badges — TeamSync AI" },
      {
        property: "og:description",
        content:
          "Give teammates structured feedback and earn recognition badges from your contributions.",
      },
    ],
  }),
  component: Page,
});
