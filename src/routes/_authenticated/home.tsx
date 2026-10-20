import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { loadLocalScans, type ScanRecord } from "@/lib/scans";
import {
  ChevronRight,
  Cloud,
  Sun,
  CloudRain,
  ShieldAlert,
  Sprout,
  Leaf,
  Calendar,
  Camera,
  TrendingUp,
  MapPin,
  MessageSquare,
  BarChart2,
  Droplets,
} from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { BottomNav } from "@/components/BottomNav";
import { HealthRing } from "@/components/HealthRing";
import { FarmRemindersCard } from "@/components/FarmRemindersCard";
import { NotificationCenterModal } from "@/components/NotificationCenterModal";
import { useLang } from "@/lib/i18n";
import { fetchWeather, listScans } from "@/lib/ai.functions";
import { useUserLocation } from "@/lib/location";
import { supabase } from "@/integrations/supabase/client";
import { auth } from "@/lib/firebase";
import { UserAvatar } from "@/components/UserAvatar";
import leafThumb from "@/assets/card_leaf_thumb.png";
import chilliFlower from "@/assets/chilli_flower_realistic.png";
import cropStageFlower from "@/assets/crop_stage_flower_rounded.png";
import cropStageIcon from "@/assets/crop_stage_icon_circle.png";
import expertFarmer from "@/assets/expert_farmer_clean.png";
import iconCrop from "@/assets/icon_crop_clean.png";
import iconCalendar from "@/assets/icon_calendar_clean.png";
import iconWeather from "@/assets/icon_weather_clean.png";
import iconRain from "@/assets/icon_rain_clean.png";
import iconRisk from "@/assets/icon_risk_clean.png";
import leafWatermark from "@/assets/leaf_watermark.png";
import { cn } from "@/lib/utils";
import { loadCropProfile, calculateHarvest } from "@/lib/crop";

const weatherQO = queryOptions({
  queryKey: ["weather"],
  queryFn: async () => {
    try {
      return await fetchWeather({ data: {} });
    } catch (e) {
      console.warn("Weather query fallback:", e);
      return {
        current: { temp: 27, humidity: 83, wind: 6, code: 2, time: new Date().toISOString() },
        daily: [
          { date: new Date().toISOString().slice(0, 10), tmax: 31, tmin: 24, rain: 2, code: 2 },
          { date: new Date(Date.now() + 864e5).toISOString().slice(0, 10), tmax: 30, tmin: 24, rain: 4, code: 2 },
          { date: new Date(Date.now() + 1728e5).toISOString().slice(0, 10), tmax: 29, tmin: 23, rain: 6, code: 61 },
        ],
        risk: "Low" as const,
        advice: "Current conditions are favourable.",
        sprayWindow: "Tomorrow 06:00 – 08:00",
      };
    }
  },
  staleTime: 10 * 60 * 1000,
});

const scansQO = queryOptions({
  queryKey: ["scans"],
  queryFn: async (): Promise<ScanRecord[]> => {
    try {
      const res = await listScans();
      const serverScans = Array.isArray(res) ? (res as ScanRecord[]) : [];
      if (typeof window !== "undefined") {
        const localScans = loadLocalScans();
        const map = new Map<string, ScanRecord>();
        for (const s of localScans) map.set(s.id, s);
        for (const s of serverScans) map.set(s.id, s);
        return Array.from(map.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }
      return serverScans;
    } catch (e) {
      console.warn("Scans query fallback:", e);
      if (typeof window !== "undefined") return loadLocalScans();
      return [];
    }
  },
  staleTime: 60 * 1000,
});

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({ meta: [{ title: "Home — MirchiRakshak AI" }] }),
  loader: async ({ context }) => {
    try {
      await Promise.all([
        context.queryClient.ensureQueryData(weatherQO),
        context.queryClient.ensureQueryData(scansQO),
      ]);
    } catch (e) {
      console.warn("Loader fallback:", e);
    }
  },
  component: HomePage,
});

function getWeatherConditionText(code?: number, t?: (k: any) => string): string {
  if (!t) return "Partly cloudy";
  if (code === undefined || code === null) return t("partlyCloudy");
  if (code === 0) return t("clearSky");
  if (code === 1 || code === 2 || code === 3) return t("partlyCloudy");
  if (code === 45 || code === 48) return t("foggy");
  if (code >= 51 && code <= 55) return t("lightDrizzle");
  if (code >= 61 && code <= 65) return t("rainy");
  if (code >= 80 && code <= 82) return t("showers");
  if (code >= 95) return t("thunderstorm");
  return t("partlyCloudy");
}


function HomePage() {
  const qc = useQueryClient();
  const { t, lang, setLang } = useLang();
  const { location: userLoc } = useUserLocation();
  const initialWeather = useSuspenseQuery(weatherQO).data;
  const scans = useSuspenseQuery(scansQO).data ?? [];

  useEffect(() => {
    const handleScansUpdate = () => {
      qc.invalidateQueries({ queryKey: ["scans"] });
    };
    window.addEventListener("mirchi_scans_updated", handleScansUpdate);
    return () => window.removeEventListener("mirchi_scans_updated", handleScansUpdate);
  }, [qc]);

  // Dynamic Crop Profile and Harvest Calculation
  const [cropProfile, setCropProfile] = useState(() => loadCropProfile());

  useEffect(() => {
    const handleCropUpdate = () => {
      setCropProfile(loadCropProfile());
    };
    window.addEventListener("mirchi_crop_updated", handleCropUpdate);
    return () => window.removeEventListener("mirchi_crop_updated", handleCropUpdate);
  }, []);

  const harvest = calculateHarvest(cropProfile.plantationDate, cropProfile.stage, lang);

  // Automatically fetch live weather for the user's detected location
  const { data: weather = initialWeather } = useQuery({
    queryKey: ["weather", userLoc?.lat, userLoc?.lon],
    queryFn: () => fetchWeather({ data: { lat: userLoc?.lat, lon: userLoc?.lon } }),
    staleTime: 10 * 60 * 1000,
    initialData: initialWeather,
    enabled: Boolean(userLoc?.lat && userLoc?.lon),
  });

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const fbUser = auth.currentUser;
      if (fbUser) {
        return {
          id: fbUser.uid,
          full_name: fbUser.displayName || "Durga",
          district: "Guntur",
          village: "Nallapadu",
          phone: fbUser.phoneNumber || null,
          avatar_url: fbUser.photoURL || null,
          language: "en" as const,
          onboarded: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      try {
        const { data } = await supabase.from("profiles").select("*").limit(1).maybeSingle();
        return data;
      } catch {
        return null;
      }
    },
  });

  const firstName = (profile?.full_name ?? "Durga").split(" ")[0];
  const latestScan = scans.length > 0
    ? [...scans].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    : null;

  // Realistic relative calculations:
  // 1. 7-Day Rainfall sum
  const rainfall7Days = Math.max(
    weather?.daily?.length ? Math.round(weather.daily.reduce((acc, d) => acc + (d.rain || 0), 0)) : 12,
    weather?.daily?.[0]?.rain ? Math.round(weather.daily[0].rain * 4) : 12,
  );

  const rainfallLevel =
    rainfall7Days === 0
      ? "Dry"
      : rainfall7Days < 16
        ? "Moderate"
        : rainfall7Days < 35
          ? "Good"
          : "Heavy";

  // 2. Realistic relative Disease Risk
  // Depends on recent scan results, ambient humidity, temperature, and rainfall
  const isScanDiseased =
    latestScan &&
    (!latestScan.is_healthy ||
      (latestScan.disease && !latestScan.disease.toLowerCase().includes("healthy")));

  let diseaseRiskLevel = "Low";
  let diseaseRiskLevelText = t("low");
  let diseaseRiskText = t("riskFavourable");

  if (isScanDiseased) {
    diseaseRiskLevel = "High";
    diseaseRiskLevelText = t("high");
    diseaseRiskText = t("riskActiveDetected");
  } else if ((weather.current.humidity ?? 83) > 80 && rainfall7Days > 15) {
    diseaseRiskLevel = "High";
    diseaseRiskLevelText = t("high");
    diseaseRiskText = t("riskHighRain");
  } else if ((weather.current.humidity ?? 83) > 75 || (weather.current.temp ?? 27) > 32) {
    diseaseRiskLevel = "Medium";
    diseaseRiskLevelText = t("medium");
    diseaseRiskText = t("riskModerate");
  } else {
    diseaseRiskLevel = "Low";
    diseaseRiskLevelText = t("low");
    diseaseRiskText = t("riskFavourable");
  }

  // 3. Realistic Crop Health Score
  let healthScore = 88;
  if (latestScan) {
    if (latestScan.is_healthy) {
      healthScore = Math.min(96, Math.max(86, Math.round((latestScan.confidence || 0.92) * 100)));
    } else {
      healthScore = Math.max(48, 82 - scans.filter((s) => !s.is_healthy).length * 8);
    }
  }

  const healthBadge =
    healthScore >= 80 ? t("goodCondition") : healthScore >= 60 ? t("moderateCondition") : t("needsAttentionBadge");

  const isHealthyOverall = healthScore >= 75;

  return (
    <PhoneShell>
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#fafaf9]/90 backdrop-blur-md pt-7 px-5 pb-3">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-emerald-900/80 text-xs font-semibold tracking-tight">
              {t("greeting")}, {firstName}
            </p>
            <h1 className="text-[22px] sm:text-[24px] font-black tracking-tight text-stone-900 leading-none mt-1 flex items-center whitespace-nowrap">
              <span className="text-emerald-600 font-black mr-1.5 leading-none select-none">|</span>
              {t("appName")}
            </h1>
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="size-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
              <p className="text-[10px] text-stone-500 font-bold uppercase tracking-widest truncate">
                {(userLoc?.district || profile?.district || "GUNTUR").toUpperCase()} • {t("online")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-0.5 shrink-0">
            {/* Quick Language Toggle */}
            <div className="flex items-center bg-stone-100/90 rounded-full p-0.5 border border-stone-200/80 text-[10px] font-bold">
              {(["en", "te", "hi"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={cn(
                    "px-2 py-0.5 rounded-full transition-all",
                    lang === l
                      ? "bg-[#184e38] text-white shadow-xs"
                      : "text-stone-600 hover:text-stone-900"
                  )}
                >
                  {l === "en" ? "EN" : l === "te" ? "తె" : "हि"}
                </button>
              ))}
            </div>

            <NotificationCenterModal />
            <Link
              to="/profile"
              className="size-10 rounded-full block cursor-pointer shrink-0 active:scale-95 transition"
              aria-label="Go to Profile"
            >
              <UserAvatar name={profile?.full_name || "Durga"} />
            </Link>
          </div>
        </div>
      </header>

      <main className="px-5 pt-3 pb-8 space-y-4">
        {/* Main Crop Health Card */}
        <section className="bg-white rounded-[28px] p-5 border border-stone-200/70 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.06)] animate-rise">
          {/* Card Header */}
          <div className="flex items-start justify-between gap-2 mb-5">
            <div className="flex items-start gap-3">
              <img
                src={iconCrop}
                alt="Crop Health"
                className="size-11 rounded-2xl object-contain shrink-0"
              />
              <div>
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.16em]">
                  {t("cropHealth")}
                </p>
                <h2 className="text-[15px] font-bold text-stone-900 leading-snug">
                  {cropProfile.variety || "Teja (S-17)"} <span className="text-stone-300 font-normal">•</span> {harvest.localizedStage.label}
                </h2>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-stone-500 font-medium">
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3 text-stone-400" />
                    {userLoc?.district || profile?.district || "Guntur"}, {userLoc?.state || "Andhra Pradesh"}
                  </span>
                </div>
              </div>
            </div>

            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shrink-0",
                isHealthyOverall
                  ? "bg-[#dcfce7] text-[#15803d]"
                  : "bg-amber-100 text-amber-800",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  isHealthyOverall ? "bg-[#16a34a]" : "bg-amber-500",
                )}
              />
              {isHealthyOverall ? t("healthy") : t("needsAttentionBadge")}
            </span>
          </div>

          {/* Card Body: Left circular gauge + Right stacked cards */}
          <div className="flex items-center gap-3">
            {/* Left Gauge */}
            <div className="w-[116px] shrink-0">
              <HealthRing
                value={healthScore}
                size={112}
                conditionText={healthBadge}
                subtext={t("subtextBasedOnScan")}
              />
            </div>

            {/* Right Stacked Cards */}
            <div className="flex-1 min-w-0 space-y-2.5">
              {/* Leaf Condition (AI) */}
              <Link
                to="/history"
                className="bg-[#f4fbf6] hover:bg-[#eef8f1] border border-[#d8f3e2] rounded-2xl p-2.5 block transition group shadow-2xs active:scale-[0.99]"
              >
                {/* Header: moved all the way to left, full text in one line */}
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="size-4 rounded-full bg-[#dcfce7] grid place-items-center shrink-0">
                      <Leaf className="size-2.5 text-[#15803d] fill-[#15803d]" />
                    </div>
                    <span className="text-xs font-semibold text-[#1e2631] whitespace-nowrap">
                      {t("leafCondition")}
                    </span>
                  </div>
                  <ChevronRight className="size-4 text-stone-900 stroke-[2.5] group-hover:translate-x-0.5 transition shrink-0" />
                </div>

                {/* Content: leaf image on left, diagnosis and recommendation on right */}
                <div className="flex items-center gap-2.5">
                  <img
                    src={latestScan?.image_url || leafThumb}
                    alt="Scanned Leaf"
                    className="size-11 rounded-xl object-cover shrink-0 shadow-2xs"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-[#004d20] leading-snug line-clamp-1">
                      {latestScan?.is_healthy !== false ? t("healthy") : latestScan?.disease || t("needsAttentionBadge")}
                    </p>
                    <p className="text-[10.5px] text-[#525a66] font-medium leading-snug mt-0.5 line-clamp-2">
                      {latestScan?.recommendation || t("noDiseaseDetected")}
                    </p>
                  </div>
                </div>
              </Link>

              {/* Last Field Check */}
              <Link
                to="/history"
                className="bg-[#fef9ef] hover:bg-[#fef4e2] border border-[#fdecd2] rounded-2xl p-2.5 flex items-center gap-2.5 transition group shadow-2xs active:scale-[0.99]"
              >
                <div className="size-11 rounded-full bg-[#fef3c7] border border-[#fde68a]/70 grid place-items-center shrink-0">
                  <img src={iconCalendar} alt="Field Check" className="size-6 object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#151c26]">
                    {t("lastScan")}
                  </p>
                  <p className="text-[15px] font-black text-stone-950 leading-tight mt-0.5">
                    {latestScan?.created_at
                      ? new Date(latestScan.created_at).toLocaleDateString(
                        lang === "te" ? "te-IN" : lang === "hi" ? "hi-IN" : "en-GB",
                        {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }
                      )
                      : "8 Oct 2026"}
                  </p>
                  <p className="text-[11px] text-[#3f484e] font-medium leading-snug mt-0.5">
                    {t("leavesNormalFlowering")}
                  </p>
                </div>
                <ChevronRight className="size-4 text-stone-900 stroke-[2.5] group-hover:translate-x-0.5 transition shrink-0" />
              </Link>
            </div>
          </div>
        </section>

        {/* 2-Column Conditions Grid: Weather & Disease Risk */}
        <section className="grid grid-cols-2 gap-3">
          {/* Card 1: WEATHER (TODAY) */}
          <Link
            to="/weather"
            className="bg-gradient-to-br from-[#1b5583] to-[#123e63] text-white rounded-3xl p-4 shadow-sm relative overflow-hidden flex flex-col justify-between min-h-[148px] active:scale-[0.98] transition group"
          >
            <div className="absolute -right-4 -top-4 size-20 bg-white/10 rounded-full blur-2xl pointer-events-none" />
            <div>
              <div className="flex items-center gap-2">
                <img src={iconWeather} alt="Weather" className="size-9 object-contain shrink-0" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-sky-200/90 truncate">
                  {t("weatherForecast")}
                </p>
              </div>

              <div className="mt-2.5">
                <p className="text-3xl font-extrabold tracking-tight">
                  {weather.current.temp ?? 27}°C
                </p>
                <p className="text-xs text-sky-100/90 font-medium mt-0.5">
                  {getWeatherConditionText(weather.current.code, t)}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-sky-100/90 font-medium pt-2 border-t border-white/10">
              <span className="flex items-center gap-1">
                <Droplets className="size-3 text-sky-300" />
                {t("humidity")}: {weather.current.humidity ?? 83}%
              </span>
              <ChevronRight className="size-3.5 text-sky-300 group-hover:translate-x-0.5 transition" />
            </div>
          </Link>

          {/* Card 2: DISEASE RISK */}
          <div
            className={cn(
              "rounded-3xl p-4 shadow-sm relative flex flex-col justify-between min-h-[148px] select-none border",
              diseaseRiskLevel === "High"
                ? "bg-[#fef2f2] border-rose-200"
                : diseaseRiskLevel === "Medium"
                  ? "bg-[#fffbeb] border-amber-200"
                  : "bg-[#fff1f2] border-rose-100",
            )}
          >
            <div>
              <div className="flex items-center gap-2">
                <div className="size-9 rounded-2xl bg-rose-100/90 grid place-items-center shrink-0">
                  <img src={iconRisk} alt="Disease Risk" className="size-6 object-contain" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                  {t("diseaseRiskTitle")}
                </p>
              </div>

              <div className="mt-2.5">
                <p className="text-2xl font-extrabold tracking-tight text-stone-900">
                  {diseaseRiskLevelText}
                </p>
                <p className="text-[11px] text-stone-600 font-medium mt-0.5 leading-snug line-clamp-2">
                  {diseaseRiskText}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Card: CROP STAGE */}
        <Link
          to="/profile"
          className="block bg-[#ecf8f0] hover:bg-[#e4f5ea] border border-[#cdebd6] text-stone-900 rounded-3xl p-4 shadow-sm relative select-none transition group"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <img
                  src={cropStageIcon}
                  alt="Stage"
                  className="size-9 object-contain shrink-0"
                />
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#1e4e38] shrink-0">
                    {t("cropStageTitle")}
                  </p>
                  <span className="text-[9px] font-bold text-emerald-800 bg-emerald-200/70 px-1.5 py-0.5 rounded-md truncate max-w-[130px]">
                    {cropProfile.variety || "Teja (S-17)"}
                  </span>
                </div>
              </div>

              <div className="mt-2">
                <p className="text-xl font-extrabold tracking-tight text-stone-900">
                  {harvest.localizedStage.shortLabel}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-[#264e36] font-bold">
                    {harvest.harvestStatus}
                  </p>
                  <span className="text-[10px] text-stone-400 font-medium">
                    • {harvest.daysInFieldText}
                  </span>
                </div>
              </div>
            </div>

            <div className="relative shrink-0">
              <img
                src={cropStageFlower}
                alt="Crop Stage"
                className="size-16 rounded-2xl object-cover shadow-2xs group-hover:scale-105 transition"
              />
              <span className="absolute -bottom-1 -right-1 bg-white/95 backdrop-blur-xs text-[9px] font-bold text-emerald-800 px-1.5 py-0.2 rounded-full border border-emerald-300 shadow-2xs">
                {t("edit")}
              </span>
            </div>
          </div>
        </Link>

        {/* Banner 1: Scan your crop */}
        <Link
          to="/scan"
          className="relative block overflow-hidden bg-gradient-to-r from-[#ea580c] via-[#f97316] to-[#fb923c] text-white rounded-3xl p-5 shadow-[0_16px_36px_-12px_rgba(234,88,12,0.4)] active:scale-[0.98] transition group animate-rise"
        >
          {/* Exact twin leaf pattern watermark in background */}
          <img
            src={leafWatermark}
            alt=""
            className="absolute right-6 -bottom-3 w-28 h-auto opacity-25 pointer-events-none select-none"
          />

          <div className="relative flex items-center gap-4">
            <div className="size-13 rounded-2xl bg-white/20 grid place-items-center ring-1 ring-white/30 backdrop-blur-sm shrink-0">
              <Camera className="size-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold leading-tight">{t("scanCrop")}</h3>
              <p className="text-xs text-white/90 font-medium mt-0.5">
                {t("scanCropSub")}
              </p>
            </div>
            <ChevronRight className="size-5 text-white/90 group-hover:translate-x-0.5 transition shrink-0" />
          </div>
        </Link>

        {/* Banner 2: Expert Consultation */}
        <Link
          to="/advisor"
          className="relative block overflow-hidden bg-[#0a522a] hover:bg-[#084724] text-white rounded-[26px] shadow-[0_12px_28px_-8px_rgba(9,82,42,0.45)] active:scale-[0.98] transition group animate-rise min-h-[114px]"
        >
          <div className="relative flex items-center justify-between pl-5 pr-3 py-3">
            {/* Left Content */}
            <div className="flex-1 min-w-0 pr-1 z-10 py-0.5">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-emerald-100/90 flex items-center gap-1.5">
                <TrendingUp className="size-3.5 text-white stroke-[2.5]" />
                {t("expertConsultation")}
              </p>
              <h3 className="text-[22px] font-bold tracking-tight text-white mt-1 leading-tight">
                {t("getExpertAdvice")}
              </h3>
              <p className="text-[12px] text-emerald-100/85 font-normal mt-1 leading-relaxed max-w-[215px]">
                {t("getExpertAdviceSub")}
              </p>
            </div>

            {/* Right Graphic: Exact farmer illustration with speech bubble + Chevron */}
            <div className="flex items-center shrink-0 -my-3 relative self-stretch">
              <img
                src={expertFarmer}
                alt="Expert Farmer Advisor"
                className="h-[114px] w-auto object-contain object-bottom select-none pointer-events-none"
              />
              <ChevronRight className="size-5 text-white stroke-[2.5] ml-1 group-hover:translate-x-0.5 transition shrink-0" />
            </div>
          </div>
        </Link>

        {/* Farm Reminders */}
        <FarmRemindersCard />
      </main>

      <BottomNav />
    </PhoneShell>
  );
}
