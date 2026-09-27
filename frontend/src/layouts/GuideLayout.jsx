import { Outlet } from "@/lib/router-compat";
import Sidebar from "../components/navbar/Sidebar";
import { SidebarProvider } from "../context/SidebarContext";
import GuideTopologyBackground from "../components/animations/GuideTopologyBackground";

const GuideLayout = () => {
  return (
    <SidebarProvider>
      <div className="relative flex h-screen w-full bg-cloud text-slate-ink selection:bg-mint/20 selection:text-mint overflow-hidden">
        {/* Animated Faculty Supervision Radar & Topology Mesh Background */}
        <GuideTopologyBackground />

        {/* Sidebar */}
        <Sidebar role="guide" />

        {/* Main Content Pane with constant sticky navbar and smooth scrolling */}
        <div className="relative z-10 flex-1 min-w-0 flex flex-col h-screen overflow-y-auto overflow-x-hidden scrollbar-thin">
          <Outlet />
        </div>
      </div>
    </SidebarProvider>
  );
};

export default GuideLayout;
