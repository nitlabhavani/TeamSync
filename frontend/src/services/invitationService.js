import { api } from "../lib/apiClient";

export const getInvitation = async (token) => api.get(`/invitations/${token}`);
export const acceptInvitation = async (token) => api.post(`/invitations/${token}/accept`);
export const rejectInvitation = async (token) => api.post(`/invitations/${token}/reject`);
export const verifyOtp = async (token, otp) =>
  api.post(`/invitations/${token}/verify-otp`, { otp });
export const resendOtp = async (token) => api.post(`/invitations/${token}/resend-otp`);
