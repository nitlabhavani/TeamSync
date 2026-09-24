import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/InvitationPage";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "Team Invitation — TeamSync AI" },
      { name: "description", content: "Review and respond to your TeamSync AI group invitation." },
      { property: "og:title", content: "Team Invitation — TeamSync AI" },
      {
        property: "og:description",
        content: "Review and respond to your TeamSync AI group invitation.",
      },
    ],
  }),
  component: Page,
});
