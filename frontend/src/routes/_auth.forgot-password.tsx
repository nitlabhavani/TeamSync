import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/auth/ForgotPassword";

export const Route = createFileRoute("/_auth/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password — TeamSync AI" },
      {
        name: "description",
        content: "Request a password reset code for your TeamSync AI account.",
      },
      { property: "og:title", content: "Reset password — TeamSync AI" },
      {
        property: "og:description",
        content: "Request a password reset code for your TeamSync AI account.",
      },
    ],
  }),
  component: Page,
});
