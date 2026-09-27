import { Outlet } from "@/lib/router-compat";
import Sidebar from "../components/navbar/Sidebar";
import { SidebarProvider } from "../context/SidebarContext";
import StudentVantaBackground from "../components/animations/StudentVantaBackground";

const StudentLayout = () => {
  return (
    <SidebarProvider>
      <div className="relative flex h-screen w-full bg-cloud text-slate-ink selection:bg-brand/20 selection:text-brand-deep overflow-hidden">
        {/* Animated Cyber-Constellation Net & Aurora Background */}
        <StudentVantaBackground />

        {/* Sidebar */}
        <Sidebar role="student" />

        {/* Main Content Pane with constant sticky navbar and smooth scrolling */}
        <div className="relative z-10 flex-1 min-w-0 flex flex-col h-screen overflow-y-auto overflow-x-hidden scrollbar-thin">
          <Outlet />
        </div>
      </div>
    </SidebarProvider>
  );
};

export default StudentLayout;
