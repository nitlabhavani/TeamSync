import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/common/InvitationPage";

export const Route = createFileRoute("/join/$token")({
  head: () => ({
    meta: [
      { title: "Join invitation — TeamSync AI" },
      { name: "description", content: "Enter the invitation OTP to join the TeamSync AI group." },
      { property: "og:title", content: "Join invitation — TeamSync AI" },
      {
        property: "og:description",
        content: "Enter the invitation OTP to join the TeamSync AI group.",
      },
    ],
  }),
  component: Page,
});
