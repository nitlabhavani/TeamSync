import { useEffect, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import * as whatIfService from "../../services/projectWhatIfService";
import * as taskService from "../../services/taskService";
import ProjectWhatIfSimulator from "./ProjectWhatIfSimulator";

/**
 * STEP 25 — AI Project What-If Simulator panel.
 *
 * Guide/team-leader only (backend-enforced — see
 * backend/src/controllers/projectWhatIfController.js). A normal student
 * passed the same `groupId` gets a 403 from the capabilities call, which
 * this panel treats as "show the student-safe notice", never the full
 * simulator — see spec §STUDENT-SAFE OUTPUT.
 *
 * Fetches the group's current tasks/members once (for the scenario picker)
 * and the capabilities list (so the picker only ever offers change types
 * this project's current data can actually simulate).
 */
const ProjectWhatIfPanel = ({ groupId, members = [], isGuideOrLeader = true }) => {
  const [capabilities, setCapabilities] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!groupId || !isGuideOrLeader) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [caps, groupTasks] = await Promise.all([
          whatIfService.getWhatIfCapabilities(groupId),
          taskService.getTasks(groupId),
        ]);
        if (cancelled) return;
        setCapabilities(caps);
        setTasks(groupTasks);
      } catch (e) {
        if (cancelled) return;
        const msg = e.message || "";
        if (msg.includes("403") || /guide or team leader/i.test(msg)) setForbidden(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, isGuideOrLeader]);

  if (!isGuideOrLeader || forbidden) {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-1">
          <FlaskConical className="w-4 h-4 text-brand" /> AI What-If Simulator
        </p>
        <p className="text-sm text-slate-muted">Your guide can simulate project changes before applying them.</p>
      </div>
    );
  }

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel space-y-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
        <FlaskConical className="w-4 h-4 text-brand" /> AI What-If Simulator
      </p>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-slate-muted py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading scenario options…
        </p>
      )}

      {!loading && capabilities && (
        <ProjectWhatIfSimulator groupId={groupId} capabilities={capabilities} tasks={tasks} members={members} />
      )}

      {!loading && !capabilities && (
        <p className="text-sm text-slate-muted">Couldn't load simulator capabilities for this group.</p>
      )}
    </div>
  );
};

export default ProjectWhatIfPanel;
