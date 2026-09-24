import { Outlet } from "@/lib/router-compat";
import Sidebar from "../components/navbar/Sidebar";
import { SidebarProvider } from "../context/SidebarContext";

const StudentLayout = () => {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-cloud">
        <Sidebar role="student" />
        <div className="flex-1 min-w-0 flex flex-col">
          <Outlet />
        </div>
      </div>
    </SidebarProvider>
  );
};

export default StudentLayout;
