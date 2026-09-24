import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/auth/Signup";

export const Route = createFileRoute("/_auth/signup")({
  head: () => ({
    meta: [
      { title: "Create account — TeamSync AI" },
      {
        name: "description",
        content: "Create a TeamSync AI account as a student or project guide.",
      },
      { property: "og:title", content: "Create account — TeamSync AI" },
      {
        property: "og:description",
        content: "Create a TeamSync AI account as a student or project guide.",
      },
    ],
  }),
  component: Page,
});
