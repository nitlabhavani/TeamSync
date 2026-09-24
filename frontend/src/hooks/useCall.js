import { useContext } from "react";
import { CallContext } from "../context/CallContext";

export const useCall = () => {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within a CallProvider");
  return ctx;
};
