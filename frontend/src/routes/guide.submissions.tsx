import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/guide/SubmissionReview";

export const Route = createFileRoute("/guide/submissions")({
  head: () => ({
    meta: [
      { title: "Submission review — TeamSync AI" },
      {
        name: "description",
        content: "Review AI-analyzed task submissions and approve, request changes, or reject.",
      },
      { property: "og:title", content: "Submission review — TeamSync AI" },
      {
        property: "og:description",
        content: "Review AI-analyzed task submissions and approve, request changes, or reject.",
      },
    ],
  }),
  component: Page,
});
