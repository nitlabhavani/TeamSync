import { useEffect, useState } from "react";
import { Bell, Lock, Mail, Loader2, Palette, ShieldCheck, KeyRound, Check, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { BG_THEMES_LIGHT, BG_THEMES_DARK } from "../../context/ThemeContext";
import Navbar from "../../components/navbar/Navbar";
import * as profileService from "../../services/profileService";

const Toggle = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${checked ? "bg-brand" : "bg-slate-line"}`}
    aria-pressed={checked}
  >
    <span
      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
        checked ? "translate-x-[18px]" : "translate-x-[2px]"
      }`}
    />
  </button>
);

const Row = ({ icon: Icon, title, body, checked, onChange }) => (
  <div className="flex items-center gap-3.5 py-4">
    <span className="w-9 h-9 rounded-lg bg-cloud flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4 text-slate-muted" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-slate-ink">{title}</p>
      <p className="text-xs text-slate-muted mt-0.5">{body}</p>
    </div>
    <Toggle checked={checked} onChange={onChange} />
  </div>
);

/** Shared settings screen for both students and guides. */
const SettingsPage = ({ role = "student" }) => {
  const { theme, setTheme, bgTheme, setBgTheme, resolvedTheme } = useTheme();
  const [prefs, setPrefs] = useState({ emailNotifications: true, pushNotifications: true, theme: "system" });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [pwd, setPwd] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdErr, setPwdErr] = useState("");

  useEffect(() => {
    profileService
      .getMyProfile()
      .then((p) => {
        const nextSettings = p.settings || {};
        setPrefs((prev) => ({ ...prev, ...nextSettings }));
        if (nextSettings.theme && ["light", "dark", "system"].includes(nextSettings.theme)) {
          setTheme(nextSettings.theme, false);
        }
        if (nextSettings.bgTheme) {
          setBgTheme(nextSettings.bgTheme, false);
        }
      })
      .catch((err) => setError(err.message || "Could not load your settings."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (key) => async (value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setStatus("");
    try {
      await profileService.updateSettings({ [key]: value });
      setStatus("Saved");
      setError("");
    } catch (err) {
      setError(err.message || "Could not save that preference.");
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwdErr("");
    setPwdMsg("");
    if (pwd.newPassword.length < 8) return setPwdErr("New password must be at least 8 characters.");
    if (pwd.newPassword !== pwd.confirm) return setPwdErr("New passwords do not match.");
    setPwdBusy(true);
    try {
      await profileService.changePassword({
        currentPassword: pwd.currentPassword,
        newPassword: pwd.newPassword,
      });
      setPwd({ currentPassword: "", newPassword: "", confirm: "" });
      setPwdMsg("Password changed successfully.");
    } catch (err) {
      setPwdErr(err.message || "Could not change your password.");
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <>
      <Navbar title="Settings" subtitle="Manage notifications, privacy and your password" />
      <main className="flex-1 px-5 md:px-8 py-6 max-w-2xl w-full mx-auto space-y-5">
        {error && (
          <div className="bg-coral-soft border border-coral/30 text-coral text-sm rounded-lg px-4 py-3">{error}</div>
        )}

        <div className="bg-paper border border-slate-line rounded-xl2 px-5 divide-y divide-slate-line">
          {loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-brand" />
            </div>
          ) : (
            <>
              <Row
                icon={Mail}
                title="Email notifications"
                body={
                  role === "guide"
                    ? "Invitation responses, inactive-member alerts and weekly AI reports"
                    : "Invitations, group updates and AI reports sent to your inbox"
                }
                checked={!!prefs.emailNotifications}
                onChange={update("emailNotifications")}
              />
              <Row
                icon={Bell}
                title="In-app notifications"
                body="Real-time alerts for messages, files and group activity"
                checked={!!prefs.pushNotifications}
                onChange={update("pushNotifications")}
              />
              <div className="py-4 space-y-4">
                <div className="flex items-center gap-3.5">
                  <span className="w-9 h-9 rounded-lg bg-cloud flex items-center justify-center shrink-0">
                    <Palette className="w-4 h-4 text-slate-muted" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-ink">Appearance Mode</p>
                    <p className="text-xs text-slate-muted mt-0.5">
                      Choose between light, dark, or sync with your system preference
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-1">
                  {[
                    { id: "light", label: "Light", icon: Sun },
                    { id: "dark", label: "Dark", icon: Moon },
                    { id: "system", label: "System", icon: Monitor },
                  ].map(({ id, label, icon: ModeIcon }) => {
                    const active = (theme || prefs.theme || "system") === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={async () => {
                          setPrefs((prev) => ({ ...prev, theme: id }));
                          await setTheme(id, true);
                          setStatus("Theme mode updated");
                        }}
                        className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs sm:text-sm font-medium transition-all ${
                          active
                            ? "bg-brand text-white border-brand shadow-sm font-semibold"
                            : "bg-cloud/50 hover:bg-cloud border-slate-line text-slate-ink"
                        }`}
                      >
                        <ModeIcon className="w-4 h-4 shrink-0" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Background Theme Style Palette Selection */}
                <div className="pt-3 border-t border-slate-line/60">
                  <div className="mb-2.5">
                    <p className="text-xs font-semibold text-slate-ink">
                      Background Palette ({resolvedTheme === "dark" ? "Dark Options" : "Light Options"})
                    </p>
                    <p className="text-[11px] text-slate-muted">
                      Select a background tint suited for your display
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(resolvedTheme === "dark" ? BG_THEMES_DARK : BG_THEMES_LIGHT).map((palette) => {
                      const isCurrent = (bgTheme || "default") === palette.id;
                      return (
                        <button
                          key={palette.id}
                          type="button"
                          onClick={async () => {
                            await setBgTheme(palette.id, true);
                            setStatus("Background palette updated");
                          }}
                          className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                            isCurrent
                              ? "border-brand ring-2 ring-brand/30 bg-paper shadow-sm"
                              : "border-slate-line hover:border-slate-muted/50 bg-cloud/40"
                          }`}
                        >
                          <span
                            className="w-5 h-5 rounded-full border border-slate-line shrink-0 shadow-inner"
                            style={{ backgroundColor: palette.preview }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-ink truncate">{palette.label}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        {status && (
          <p className="text-xs text-mint inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> {status}
          </p>
        )}

        <section className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-8 h-8 rounded-lg bg-brand-soft flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-brand-deep" />
            </span>
            <div>
              <h3 className="font-display font-semibold text-slate-ink leading-tight">Change password</h3>
              <p className="text-xs text-slate-muted mt-0.5">Passwords are hashed before they are stored.</p>
            </div>
          </div>

          <form onSubmit={changePassword} className="space-y-3">
            {[
              { key: "currentPassword", label: "Current password" },
              { key: "newPassword", label: "New password" },
              { key: "confirm", label: "Confirm new password" },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-xs text-slate-muted">{f.label}</label>
                <input
                  type="password"
                  value={pwd[f.key]}
                  onChange={(e) => setPwd({ ...pwd, [f.key]: e.target.value })}
                  className="w-full mt-1 border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
                  required
                />
              </div>
            ))}
            {pwdErr && <p className="text-xs text-coral">{pwdErr}</p>}
            {pwdMsg && <p className="text-xs text-mint">{pwdMsg}</p>}
            <button
              type="submit"
              disabled={pwdBusy}
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-deep text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-70"
            >
              {pwdBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Update password
            </button>
          </form>
        </section>

        <p className="text-xs text-slate-muted leading-relaxed inline-flex gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 text-mint" />
          Private one-to-one chats are never analyzed by AI. Only group project chats are used to generate
          collaboration insights.
        </p>
      </main>
    </>
  );
};

export default SettingsPage;
