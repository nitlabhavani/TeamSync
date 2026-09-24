import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/auth/VerifyOtp";

export const Route = createFileRoute("/_auth/verify-otp")({
  head: () => ({
    meta: [
      { title: "Verify code — TeamSync AI" },
      { name: "description", content: "Enter the 6-digit verification code sent to your email." },
      { property: "og:title", content: "Verify code — TeamSync AI" },
      {
        property: "og:description",
        content: "Enter the 6-digit verification code sent to your email.",
      },
    ],
  }),
  component: Page,
});
