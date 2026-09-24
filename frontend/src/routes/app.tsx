import { createFileRoute } from "@tanstack/react-router";
import StudentLayout from "@/layouts/StudentLayout";
import { RequireRole } from "@/lib/require-role";

export const Route = createFileRoute("/app")({
  component: () => (
    <RequireRole role="student">
      <StudentLayout />
    </RequireRole>
  ),
});
