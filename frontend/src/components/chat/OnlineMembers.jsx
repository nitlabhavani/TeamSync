import { getInitials } from "../../utils/helperFunctions";

const OnlineMembers = ({ members = [] }) => {
  const visible = members.slice(0, 4);
  const extra = members.length - visible.length;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {visible.map((m) => (
          <span
            key={m.id}
            title={m.name}
            className="w-7 h-7 rounded-full border-2 border-paper flex items-center justify-center text-[10px] font-semibold text-white"
            style={{ backgroundColor: m.color }}
          >
            {getInitials(m.name)}
          </span>
        ))}
        {extra > 0 && (
          <span className="w-7 h-7 rounded-full border-2 border-paper bg-cloud flex items-center justify-center text-[10px] font-semibold text-slate-muted">
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
};

export default OnlineMembers;
