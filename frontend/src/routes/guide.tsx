import { createFileRoute } from "@tanstack/react-router";
import GuideLayout from "@/layouts/GuideLayout";
import { RequireRole } from "@/lib/require-role";

export const Route = createFileRoute("/guide")({
  component: () => (
    <RequireRole role="guide">
      <GuideLayout />
    </RequireRole>
  ),
});
