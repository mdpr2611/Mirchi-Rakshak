import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ChevronRight, LogOut, Globe, MapPin, Sprout, Calendar, Sparkles, Check, Clock, Edit3, Lock, Eye, EyeOff, KeyRound } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { BottomNav } from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import { useLang, languageOptions, type Lang } from "@/lib/i18n";
import { useUserLocation } from "@/lib/location";
import { UserAvatar } from "@/components/UserAvatar";
import {
  loadCropProfile,
  saveCropProfile,
  calculateHarvest,
  COMMON_VARIETIES,
  STAGE_CONFIG,
  type CropStage,
} from "@/lib/crop";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — MirchiRakshak" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { t, lang, setLang } = useLang();
  const { location: userLoc, refreshLocation, isLoading: isLocLoading } = useUserLocation();
  const nav = useNavigate();

  // Crop profile state
  const [cropData, setCropData] = useState(() => loadCropProfile());
  const [customVariety, setCustomVariety] = useState("");
  const [isSavingCrop, setIsSavingCrop] = useState(false);

  // Change password state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success(t("updatePassword") + " successfully!");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordChange(false);
    } catch (err: any) {
      console.error("Change password error:", err);
      toast.error(err?.message || "Failed to update password.");
    } finally {
      setIsUpdatingPassword(false);
    }
  }

  // Live harvest calculation
  const harvest = calculateHarvest(cropData.plantationDate, cropData.stage, lang);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      const meta = user.user_metadata || {};
      const isPhoneEmail = (user.email || "").startsWith("farmer_");
      const displayEmail = isPhoneEmail ? (meta.phone || data?.phone || "") : (user.email || "");
      return {
        ...data,
        full_name: data?.full_name || meta.full_name || meta.name || (isPhoneEmail ? "Farmer" : user.email?.split("@")[0]) || "Farmer",
        email: displayEmail,
        phone: data?.phone || meta.phone || "",
        avatar_url: meta.avatar_url || null,
        district: data?.district || "Guntur",
      };
    },
  });

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Sign out error:", e);
    }
    nav({ to: "/auth" });
  }

  async function saveLang(l: Lang) {
    setLang(l);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase.from("profiles").update({ language: l }).eq("id", user.id);
      if (error) toast.error(error.message);
    }
  }

  async function handleSaveCrop() {
    setIsSavingCrop(true);
    try {
      const effectiveVariety =
        cropData.variety === "Other" && customVariety.trim()
          ? customVariety.trim()
          : cropData.variety || "Teja (S-17)";

      const updated = {
        ...cropData,
        variety: effectiveVariety,
      };

      saveCropProfile(updated);

      // Upsert into Supabase farms table if logged in
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("farms").upsert(
            {
              user_id: user.id,
              name: "Mirchi Farm",
              variety: updated.variety,
              planting_date: updated.plantationDate,
            },
            { onConflict: "user_id" }
          );
        }
      } catch (e) {
        console.warn("Supabase farm sync fallback:", e);
      }

      toast.success("Crop details saved! Dashboard harvest updated.", {
        icon: "🌾",
      });
    } catch (err) {
      console.error(err);
      toast.error("Failed to save crop details");
    } finally {
      setIsSavingCrop(false);
    }
  }

  // Maximum selectable date is today
  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <PhoneShell>
      <header className="px-5 pt-10 pb-4 flex items-center justify-between">
        <Link to="/home" className="size-10 rounded-full bg-white ring-1 ring-black/5 grid place-items-center shadow-sm" aria-label="Back">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-base font-semibold text-stone-800">{t("profile")}</h1>
        <div className="size-10" />
      </header>

      <main className="px-5 space-y-4 pb-20">
        {/* User Card */}
        <section className="bg-white rounded-3xl p-5 ring-1 ring-black/5 shadow-sm flex items-center gap-4 animate-rise">
          <UserAvatar
            name={profile?.full_name || "Durga"}
            sizeClassName="size-16"
            fontSizeClassName="text-2xl"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-stone-900 truncate">{profile?.full_name ?? "Farmer"}</h2>
            <p className="text-xs text-stone-500 truncate">{profile?.email}</p>
            <div className="text-[10px] font-bold text-leaf-700 uppercase tracking-widest mt-1 flex items-center gap-1 flex-wrap">
              <MapPin className="size-3 text-emerald-600 shrink-0" />
              <span>{userLoc?.district || profile?.district || "Guntur"}, {userLoc?.state || "Andhra Pradesh"}</span>
              <button
                onClick={() => {
                  refreshLocation();
                  toast.success("Refreshing location...");
                }}
                className="text-[9px] lowercase bg-emerald-100 hover:bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded-full font-medium transition"
                title="Refresh location"
              >
                {isLocLoading ? "detecting..." : "auto"}
              </button>
            </div>
          </div>
        </section>

        {/* 🌾 CROP & PLANTATION DETAILS CARD */}
        <section className="bg-white rounded-3xl p-5 ring-1 ring-black/5 shadow-sm animate-rise space-y-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-2xl bg-emerald-100 text-emerald-800 grid place-items-center font-bold">
                <Sprout className="size-5 text-emerald-700" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-stone-900">{t("cropFarmDetails")}</h3>
                <p className="text-[11px] text-stone-500 font-medium">{t("cropFarmDetailsSub")}</p>
              </div>
            </div>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              {t("active")}
            </span>
          </div>

          {/* 1. Crop Variety */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-stone-700 flex items-center justify-between">
              <span>{t("varietyOfChilli")}</span>
              <span className="text-[10px] text-stone-400 font-normal">{t("selectOrEnter")}</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_VARIETIES.map((v) => {
                const isSelected = cropData.variety === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setCropData((prev) => ({ ...prev, variety: v }));
                      setCustomVariety("");
                    }}
                    className={cn(
                      "px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all text-left",
                      isSelected
                        ? "bg-[#184e38] text-white border-[#184e38] shadow-xs"
                        : "bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100"
                    )}
                  >
                    {v}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCropData((prev) => ({ ...prev, variety: "Other" }))}
                className={cn(
                  "px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all",
                  cropData.variety === "Other" || (!COMMON_VARIETIES.includes(cropData.variety) && cropData.variety !== "")
                    ? "bg-[#184e38] text-white border-[#184e38] shadow-xs"
                    : "bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100"
                )}
              >
                {t("otherVariety")}
              </button>
            </div>

            {/* Custom variety text input */}
            {(cropData.variety === "Other" || !COMMON_VARIETIES.includes(cropData.variety)) && (
              <div className="pt-1">
                <input
                  type="text"
                  placeholder={t("enterCustomVariety")}
                  value={customVariety || (COMMON_VARIETIES.includes(cropData.variety) ? "" : cropData.variety)}
                  onChange={(e) => {
                    setCustomVariety(e.target.value);
                    setCropData((prev) => ({ ...prev, variety: e.target.value }));
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl text-xs font-medium bg-stone-50 border border-stone-200 focus:bg-white focus:border-emerald-600 focus:outline-none transition"
                />
              </div>
            )}
          </div>

          {/* 2. Date of Plantation */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-stone-700 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5 text-emerald-600" />
                {t("plantationDateLabel")}
              </span>
              <span className="text-[10px] text-emerald-700 font-semibold">
                {harvest.daysInFieldText}
              </span>
            </label>
            <input
              type="date"
              max={todayStr}
              value={cropData.plantationDate}
              onChange={(e) => {
                setCropData((prev) => ({ ...prev, plantationDate: e.target.value }));
              }}
              className="w-full px-3.5 py-2.5 rounded-xl text-xs font-medium bg-stone-50 border border-stone-200 focus:bg-white focus:border-emerald-600 focus:outline-none text-stone-800 transition"
            />
          </div>

          {/* 3. Crop Stage Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-stone-700 flex items-center justify-between">
              <span>{t("cropStageLabel")}</span>
              <span className="text-[10px] text-stone-400 font-normal">{t("selectCurrentPhase")}</span>
            </label>
            <div className="grid grid-cols-1 gap-2">
              {(Object.keys(STAGE_CONFIG) as CropStage[]).map((stg) => {
                const conf = STAGE_CONFIG[stg];
                const stageDetails = calculateHarvest(cropData.plantationDate, stg, lang).localizedStage;
                const isSelected = cropData.stage === stg;
                return (
                  <button
                    key={stg}
                    type="button"
                    onClick={() => setCropData((prev) => ({ ...prev, stage: stg }))}
                    className={cn(
                      "w-full p-2.5 rounded-2xl border text-left flex items-center justify-between transition-all",
                      isSelected
                        ? "bg-[#ecf8f0] border-[#348658] shadow-xs ring-1 ring-[#348658]/30"
                        : "bg-stone-50/70 border-stone-200 hover:bg-stone-100/70"
                    )}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-stone-900">{stageDetails.label}</span>
                        {isSelected && (
                          <span className="size-4 rounded-full bg-emerald-600 text-white grid place-items-center text-[10px] shrink-0">
                            <Check className="size-2.5 stroke-[3]" />
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-stone-500 font-medium mt-0.5 truncate">{stageDetails.description}</p>
                    </div>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", conf.badgeBg, conf.textColor)}>
                      {stg === "harvesting" ? "Ready" : `~${conf.remainingDaysEstimate}d`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Live Harvest Calculation Preview Box */}
          <div className="bg-gradient-to-br from-[#103b29] to-[#1c5d41] rounded-2xl p-4 text-white shadow-md relative overflow-hidden">
            <div className="relative z-10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-200 flex items-center gap-1">
                  <Sparkles className="size-3 text-emerald-300" />
                  {t("calculatedHarvestProjection")}
                </span>
                <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-semibold">
                  Chilli • {cropData.variety || "Teja"}
                </span>
              </div>

              <div className="flex items-baseline justify-between pt-1">
                <div>
                  <div className="text-2xl font-black tracking-tight text-white">
                    {harvest.harvestStatus}
                  </div>
                  <div className="text-[11px] text-emerald-100/90 font-medium mt-0.5">
                    {t("estHarvestDate")}: <span className="font-bold text-white">{harvest.estimatedHarvestDate}</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/15 flex items-center justify-between text-[10px] text-emerald-200/90">
                <span>🌱 {t("stage")}: <strong>{harvest.localizedStage.shortLabel}</strong></span>
                <span>📅 {t("planted")}: <strong>{harvest.daysInFieldText}</strong></span>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSaveCrop}
            disabled={isSavingCrop}
            className="w-full bg-[#1e583c] hover:bg-[#184831] active:scale-[0.98] text-white rounded-2xl py-3 px-4 text-xs font-bold shadow-sm transition flex items-center justify-center gap-2"
          >
            <Check className="size-4" />
            {isSavingCrop ? t("savingCropDetails") : t("saveCropDetails")}
          </button>
        </section>

        {/* Language Section */}
        <section className="bg-white rounded-3xl p-5 ring-1 ring-black/5 shadow-sm animate-rise">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-800 mb-3">
            <Globe className="size-4 text-chili-600" /> {t("language")}
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {languageOptions.map((o) => (
              <button
                key={o.code}
                onClick={() => saveLang(o.code)}
                className={cn(
                  "rounded-xl py-2.5 text-sm font-semibold ring-1 transition",
                  lang === o.code ? "bg-stone-900 text-white ring-stone-900" : "bg-earth-50 text-stone-700 ring-black/5",
                )}
              >
                {o.native}
              </button>
            ))}
          </div>
        </section>

        {/* Change Password Section */}
        <section className="bg-white rounded-3xl p-5 ring-1 ring-black/5 shadow-sm animate-rise">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <KeyRound className="size-4 text-chili-600" /> {t("changePassword")}
            </h3>
            <button
              type="button"
              onClick={() => setShowPasswordChange(!showPasswordChange)}
              className="text-xs font-semibold text-chili-600 hover:text-chili-700 transition"
            >
              {showPasswordChange ? "Cancel" : t("changePassword")}
            </button>
          </div>

          {showPasswordChange && (
            <form onSubmit={handleChangePassword} className="mt-4 space-y-3 pt-3 border-t border-stone-100">
              <div className="relative">
                <Lock className="size-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("newPassword")}
                  required
                  minLength={6}
                  className="w-full pl-10 pr-10 py-2.5 bg-earth-50 ring-1 ring-black/5 rounded-xl text-xs placeholder:text-stone-400 focus:ring-2 focus:ring-chili-600 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  tabIndex={-1}
                >
                  {showNewPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>

              <div className="relative">
                <Lock className="size-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("confirmPassword")}
                  required
                  minLength={6}
                  className="w-full pl-10 pr-10 py-2.5 bg-earth-50 ring-1 ring-black/5 rounded-xl text-xs placeholder:text-stone-400 focus:ring-2 focus:ring-chili-600 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="w-full bg-chili-600 hover:bg-chili-700 active:scale-[0.98] text-white rounded-xl py-2.5 text-xs font-bold shadow-sm transition disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                <Check className="size-3.5" />
                {isUpdatingPassword ? "Updating..." : t("updatePassword")}
              </button>
            </form>
          )}
        </section>

        <section className="bg-white rounded-3xl ring-1 ring-black/5 shadow-sm divide-y divide-black/5 animate-rise overflow-hidden">
          {[{ label: t("history"), to: "/history" as const }].map((row) => (
            <Link key={row.to} to={row.to} className="flex items-center justify-between px-5 py-4 hover:bg-earth-50 transition">
              <span className="text-sm font-medium text-stone-800">{row.label}</span>
              <ChevronRight className="size-4 text-stone-400" />
            </Link>
          ))}
        </section>

        <button
          onClick={signOut}
          className="w-full bg-white ring-1 ring-black/5 rounded-2xl py-3.5 flex items-center justify-center gap-2 font-semibold text-destructive shadow-sm active:scale-[0.98] transition"
        >
          <LogOut className="size-4" /> {t("signOut")}
        </button>

        <p className="text-center text-[10px] text-stone-400 font-medium pb-4">MirchiRakshak AI · v1.0</p>
      </main>

      <BottomNav />
    </PhoneShell>
  );
}
