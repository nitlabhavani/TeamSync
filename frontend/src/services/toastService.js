import { toast } from "sonner";

export const showToast = (message, options = {}) => {
  toast(message, options);
};

export const showSuccess = (message, options = {}) => {
  toast.success(message, options);
};

export const showError = (message, options = {}) => {
  toast.error(message, options);
};
