import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../app/AuthContext";

type SettingsSection = "profile" | "security" | "notifications";
const MAX_AVATAR_FILE_BYTES = 4 * 1024 * 1024;
const MAX_AVATAR_DATA_URL_LENGTH = 58000;
const AVATAR_MAX_SIDE = 220;

const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    id: "profile",
    label: "Profile",
    icon: "person",
    description: "Name and email details"
  },
  {
    id: "security",
    label: "Security",
    icon: "security",
    description: "MFA and password reset controls"
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "notifications",
    description: "Email notification preferences"
  }
];

function isSettingsSection(value: string): value is SettingsSection {
  return value === "profile" || value === "security" || value === "notifications";
}

function sectionButtonClass(active: boolean): string {
  return `flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
    active
      ? "border-primary/45 bg-primary/15 text-white"
      : "border-primary/10 bg-background-dark text-slate-300 hover:border-primary/30 hover:bg-primary/10"
  }`;
}

function formInputClass(): string {
  return "w-full rounded-lg border border-primary/20 bg-background-dark px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-primary";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Unable to read image file."));
    };
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to process image file."));
    image.src = src;
  });
}

async function toAvatarDataUrl(file: File): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceDataUrl);
  const largestSide = Math.max(image.width, image.height);
  const scale = largestSide > AVATAR_MAX_SIDE ? AVATAR_MAX_SIDE / largestSide : 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to process image file.");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function initialsFromNames(firstName: string, lastName: string): string {
  const first = firstName.trim().charAt(0);
  const last = lastName.trim().charAt(0);
  const initials = `${first}${last}`.toUpperCase();
  return initials || "U";
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { section: routeSection } = useParams<{ section?: string }>();
  const { user, updateProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const section = isSettingsSection(routeSection ?? "") ? routeSection : "profile";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileStatusTone, setProfileStatusTone] = useState<"success" | "warning">("success");

  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<string | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);

  useEffect(() => {
    if (isSettingsSection(routeSection ?? "")) {
      return;
    }
    navigate("/settings/profile", { replace: true });
  }, [navigate, routeSection]);

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setEmail(user?.email ?? "");
    setAvatarUrl(user?.avatarUrl?.trim() ? user.avatarUrl.trim() : null);
  }, [user?.avatarUrl, user?.email, user?.firstName, user?.lastName]);

  const activeSection = useMemo(
    () => settingsSections.find((entry) => entry.id === section) ?? settingsSections[0],
    [section]
  );

  const saveProfile = async () => {
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedFirstName || !trimmedLastName || !trimmedEmail) {
      setProfileStatusTone("warning");
      setProfileStatus("First name, last name, and email are required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setProfileStatusTone("warning");
      setProfileStatus("Please enter a valid email address.");
      return;
    }

    setIsSavingProfile(true);
    setProfileStatus(null);
    try {
      await updateProfile({
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        email: trimmedEmail,
        avatarUrl
      });
      setProfileStatusTone("success");
      setProfileStatus("Profile settings saved.");
    } catch (error) {
      setProfileStatusTone("warning");
      setProfileStatus(error instanceof Error ? error.message : "Unable to save profile settings.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const resetProfileForm = () => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setEmail(user?.email ?? "");
    setAvatarUrl(user?.avatarUrl?.trim() ? user.avatarUrl.trim() : null);
    setProfileStatus(null);
  };

  const handleAvatarSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) {
      return;
    }

    if (!selected.type.startsWith("image/")) {
      setProfileStatusTone("warning");
      setProfileStatus("Please upload an image file.");
      event.target.value = "";
      return;
    }
    if (selected.size > MAX_AVATAR_FILE_BYTES) {
      setProfileStatusTone("warning");
      setProfileStatus("Image must be smaller than 4MB.");
      event.target.value = "";
      return;
    }

    try {
      const nextAvatarUrl = await toAvatarDataUrl(selected);
      if (nextAvatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
        setProfileStatusTone("warning");
        setProfileStatus("Image is too large. Try a smaller picture.");
      } else {
        setAvatarUrl(nextAvatarUrl);
        setProfileStatusTone("success");
        setProfileStatus("New profile picture selected. Click Save Settings.");
      }
    } catch (error) {
      setProfileStatusTone("warning");
      setProfileStatus(error instanceof Error ? error.message : "Unable to process image.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <section className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-primary/15 bg-surface-dark">
      <div className="grid lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-primary/15 bg-[#122820] p-4 lg:border-b-0 lg:border-r">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#92c9b7]">
            Settings
          </p>
          <nav className="space-y-2">
            {settingsSections.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => navigate(`/settings/${entry.id}`)}
                className={sectionButtonClass(entry.id === section)}
              >
                <span className="material-icons text-base">{entry.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{entry.label}</span>
                  <span className="block truncate text-xs text-slate-400">{entry.description}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="p-5 sm:p-6">
          <div className="mx-auto w-full max-w-2xl">
            <header className="mb-6 border-b border-primary/10 pb-4">
              <h2 className="text-xl font-bold text-white">{activeSection.label}</h2>
              <p className="text-sm text-[#92c9b7]">{activeSection.description}</p>
            </header>

            {section === "profile" ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-primary/15 bg-background-dark p-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="inline-flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-primary/25 bg-[#18372d] text-lg font-bold text-white">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
                      ) : (
                        <span>{initialsFromNames(firstName, lastName)}</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-white">Display Picture</p>
                      <p className="text-xs text-slate-400">
                        Upload a profile picture and save to apply it across the app.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:border-primary/45 hover:text-white"
                        >
                          {avatarUrl ? "Change Picture" : "Upload Picture"}
                        </button>
                        {avatarUrl ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAvatarUrl(null);
                              setProfileStatusTone("success");
                              setProfileStatus("Profile picture removed. Click Save Settings.");
                            }}
                            className="rounded-lg border border-primary/20 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-primary/35 hover:text-white"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(event) => void handleAvatarSelected(event)}
                        className="hidden"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-white">First Name</span>
                    <input
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      className={formInputClass()}
                      placeholder="First name"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-white">Last Name</span>
                    <input
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      className={formInputClass()}
                      placeholder="Last name"
                    />
                  </label>
                </div>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-white">Email</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={formInputClass()}
                    placeholder="Email"
                    type="email"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void saveProfile()}
                    disabled={isSavingProfile}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-background-dark transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-75"
                  >
                    {isSavingProfile ? "Saving..." : "Save Settings"}
                  </button>
                  <button
                    type="button"
                    onClick={resetProfileForm}
                    disabled={isSavingProfile}
                    className="rounded-lg border border-primary/25 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-75"
                  >
                    Reset
                  </button>
                </div>
                {profileStatus ? (
                  <p
                    className={`text-sm ${
                      profileStatusTone === "warning" ? "text-secondary-gold" : "text-[#92c9b7]"
                    }`}
                  >
                    {profileStatus}
                  </p>
                ) : null}
              </div>
            ) : null}

            {section === "security" ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-primary/15 bg-background-dark p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Multi-factor authentication</p>
                      <p className="text-sm text-slate-400">
                        Add an extra verification step while signing in.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMfaEnabled((value) => !value);
                        setSecurityStatus("MFA toggle is not functional yet.");
                      }}
                      className={`inline-flex h-8 w-14 items-center rounded-full border px-1 transition-colors ${
                        mfaEnabled
                          ? "border-primary bg-primary/25"
                          : "border-primary/20 bg-[#18372d]"
                      }`}
                      aria-label="Toggle multi-factor authentication"
                    >
                      <span
                        className={`h-6 w-6 rounded-full bg-white transition-transform ${
                          mfaEnabled ? "translate-x-6" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-primary/15 bg-background-dark p-4">
                  <p className="text-sm font-semibold text-white">Reset password with OTP</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Send a one-time-password to your email to reset account password.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setSecurityStatus("Password reset with OTP is not functional yet.")
                    }
                    className="mt-3 rounded-lg border border-primary/25 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-primary/40 hover:text-white"
                  >
                    Send OTP
                  </button>
                </div>

                {securityStatus ? <p className="text-sm text-secondary-gold">{securityStatus}</p> : null}
              </div>
            ) : null}

            {section === "notifications" ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-primary/15 bg-background-dark p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Email notifications</p>
                      <p className="text-sm text-slate-400">
                        Receive group invites and challenge updates by email.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEmailNotificationsEnabled((value) => !value);
                        setNotificationStatus("Email notifications toggle is not functional yet.");
                      }}
                      className={`inline-flex h-8 w-14 items-center rounded-full border px-1 transition-colors ${
                        emailNotificationsEnabled
                          ? "border-primary bg-primary/25"
                          : "border-primary/20 bg-[#18372d]"
                      }`}
                      aria-label="Toggle email notifications"
                    >
                      <span
                        className={`h-6 w-6 rounded-full bg-white transition-transform ${
                          emailNotificationsEnabled ? "translate-x-6" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
                {notificationStatus ? (
                  <p className="text-sm text-secondary-gold">{notificationStatus}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
